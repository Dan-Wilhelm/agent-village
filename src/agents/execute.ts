import "server-only";

import { z } from "zod";

import { clientFor, getClickUpAccount } from "@/integrations/clickup/account";
import { apiValueFor, keyFields } from "@/integrations/clickup/fields";
import { readVaultFile, writeVaultFile } from "@/integrations/vault/github";
import { logActivity } from "@/lib/activity";

import { assertDiscreet } from "./discretion";
import { loadRegistry, type AgentEntry } from "./registry";
import { sameListName, type ProposalKind } from "./tools";

/**
 * Executes a proposal AFTER the owner approved it (or cleans up a rejected
 * draft). Everything is re-validated here — the proposal came back from the
 * browser, so nothing in it is trusted.
 */

const taskId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const schemas = {
  comment: z.object({ task_id: taskId, text: z.string().min(1).max(4000) }),
  task_change: z.object({
    task_id: taskId,
    status: z.string().max(80).optional(),
    due_date: z.string().optional(),
    priority: z.number().int().min(1).max(4).optional(),
  }),
  draft_task: z.object({
    draft_task_id: taskId,
    target_list_id: taskId,
    status: z.string().max(80).optional(),
    fields: z.record(z.string().max(60), z.string().max(2000)).optional(),
  }),
  mission_control_message: z.object({ text: z.string().min(1).max(3000) }),
  playbook_rule: z.object({
    file: z.enum(["craft", "context"]),
    rule: z.string().min(5).max(1200),
    test_case: z.string().min(5).max(800),
    source: z.string().max(400),
    replaces: z.string().max(600).optional(),
  }),
  meeting_notes: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().min(2).max(80).regex(/^[^/\\:*?"<>|#^[\]]+$/),
    client_code: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/).optional(),
    summary: z.string().max(3000).optional(),
    notes: z.string().min(10).max(60_000),
    company_dir: z.string(),
  }),
} satisfies Record<ProposalKind, z.ZodTypeAny>;

const PERMISSION: Record<ProposalKind, string | null> = {
  comment: "propose_comment",
  task_change: "propose_change",
  draft_task: "draft_task",
  mission_control_message: "message_mission_control",
  playbook_rule: null,
  meeting_notes: "read_meeting_notes",
};

async function account() {
  const a = await getClickUpAccount();
  if (!a?.teamId) throw new Error("ClickUp is not connected.");
  return a;
}

async function assertTaskAllowed(id: string) {
  const a = await account();
  const task = await clientFor(a).getTask(id);
  if (!a.selectedSpaceIds.includes(task.space.id)) throw new Error("That task is outside the allowed spaces.");
  return { a, task };
}

function stamp() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
}

async function appendToVault(path: string, header: string, entry: string, message: string) {
  const existing = await readVaultFile(path);
  const content = existing ? `${existing.content.trimEnd()}\n${entry}\n` : `${header}\n${entry}\n`;
  await writeVaultFile(path, content, message, existing?.sha);
}

export async function executeProposal(input: { agentId: string; kind: ProposalKind; args: unknown; decision: "approve" | "reject" }) {
  const registry = await loadRegistry();
  const agent: AgentEntry | undefined = registry.agents.find((x) => x.id === input.agentId);
  if (!agent) throw new Error("Unknown agent.");
  const needed = PERMISSION[input.kind];
  if (needed && !agent.permissions.includes(needed as never)) throw new Error("This agent may not do that.");
  const company = registry.companies.find((c) => c.name === agent.company);

  // Strict isolation: ClickUp actions only in the workspace bound to the agent's company.
  if (input.kind === "comment" || input.kind === "task_change" || input.kind === "draft_task" || input.kind === "mission_control_message") {
    const a = await getClickUpAccount();
    if (!company?.clickup_team_id || !a?.teamId || a.teamId !== company.clickup_team_id) {
      throw new Error(`${agent.company} has no connected work environment — nothing was changed.`);
    }
  }

  // Rejection only needs cleanup for drafts (they already live in the drafts list).
  if (input.decision === "reject") {
    if (input.kind === "draft_task") {
      const args = schemas.draft_task.parse(input.args);
      const { a, task } = await assertTaskAllowed(args.draft_task_id);
      // Only ever delete a task that still sits in the drafts list.
      const list = await clientFor(a).getList(task.list.id);
      if (!sameListName(list.name, company?.drafts_list ?? "Drafts – pending approval")) {
        throw new Error("This task is no longer in the drafts list — nothing was deleted.");
      }
      await clientFor(a).deleteTask(args.draft_task_id);
    }
    await logActivity(`agent:${agent.id}`, `proposal.rejected.${input.kind}`);
    return { ok: true, message: "Rejected." };
  }

  switch (input.kind) {
    case "comment": {
      const args = schemas.comment.parse(input.args);
      assertDiscreet(args.text);
      const { a } = await assertTaskAllowed(args.task_id);
      await clientFor(a).createComment(args.task_id, args.text);
      await logActivity(`agent:${agent.id}`, "clickup.comment_posted", { taskId: args.task_id });
      return { ok: true, message: "Comment posted." };
    }
    case "task_change": {
      const args = schemas.task_change.parse(input.args);
      const { a } = await assertTaskAllowed(args.task_id);
      const change: Parameters<ReturnType<typeof clientFor>["updateTask"]>[1] = {};
      if (args.status) change.status = args.status;
      if (args.priority) change.priority = args.priority;
      if (args.due_date !== undefined) {
        if (args.due_date === "") change.due_date = null;
        else {
          const ms = Date.parse(args.due_date);
          if (Number.isNaN(ms)) throw new Error("Invalid due date.");
          change.due_date = ms;
          change.due_date_time = args.due_date.includes("T");
        }
      }
      await clientFor(a).updateTask(args.task_id, change);
      await logActivity(`agent:${agent.id}`, "clickup.task_changed", { taskId: args.task_id, fields: Object.keys(change) });
      return { ok: true, message: "Task updated." };
    }
    case "draft_task": {
      const args = schemas.draft_task.parse(input.args);
      const { a, task: draft } = await assertTaskAllowed(args.draft_task_id);
      const client = clientFor(a);
      const draftList = await client.getList(draft.list.id);
      if (!sameListName(draftList.name, company?.drafts_list ?? "Drafts – pending approval")) throw new Error("That task is not a draft.");
      const target = await client.getList(args.target_list_id);
      if (!a.selectedSpaceIds.includes(target.space.id)) throw new Error("Target list is outside the allowed spaces.");
      const text = draft.markdown_description ?? draft.text_content ?? "";
      assertDiscreet(`${draft.name}\n${text}\n${Object.values(args.fields ?? {}).join("\n")}`);

      // Status in the target list: the requested one, else the list's first status.
      const statuses = [...(target.statuses ?? [])].sort((x, y) => (x.orderindex ?? 0) - (y.orderindex ?? 0));
      const wanted = args.status ? statuses.find((st) => st.status.toLowerCase() === args.status!.toLowerCase()) : statuses[0];
      if (args.status && !wanted) throw new Error(`Status “${args.status}” does not exist in ${target.name}.`);

      let taskIdOut = draft.id;
      let moved = true;
      try {
        // Moving keeps template checklists/subtasks. ClickUp only accepts a status mapping when the
        // draft's status does not exist in the target list, so try without one first.
        try {
          await client.moveTask(a.teamId!, draft.id, target.id);
        } catch (first) {
          if (!(draft.status.id && wanted?.id)) throw first;
          await client.moveTask(a.teamId!, draft.id, target.id, { from: draft.status.id, to: wanted.id });
        }
        if (wanted) {
          const now = await client.getTask(draft.id);
          if (now.status.status.toLowerCase() !== wanted.status.toLowerCase()) await client.updateTask(draft.id, { status: wanted.status });
        }
      } catch (err) {
        // Fallback: create a copy in the target list (loses subtasks/checklists) and remove the draft.
        console.warn("move failed, copying instead", err instanceof Error ? err.message : err);
        moved = false;
        const created = await client.createTask(target.id, {
          name: draft.name,
          markdown_content: text,
          ...(wanted ? { status: wanted.status } : {}),
          ...(draft.due_date ? { due_date: draft.due_date } : {}),
          ...(draft.priority?.id ? { priority: Number(draft.priority.id) } : {}),
        });
        await client.deleteTask(draft.id);
        taskIdOut = created.id;
      }

      // Custom fields (validated again against the target list).
      const fieldErrors: string[] = [];
      const setNames: string[] = []; // exact ClickUp field names that were set
      if (args.fields && Object.keys(args.fields).length) {
        const { fields } = await client.getListFields(target.id);
        for (const [name, value] of Object.entries(args.fields)) {
          const def = fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
          try {
            if (!def) throw new Error(`no field “${name}”`);
            await client.setCustomField(taskIdOut, def.id, apiValueFor(def, value));
            setNames.push(def.name);
          } catch (err) {
            fieldErrors.push(`${name}: ${err instanceof Error ? err.message : "failed"}`);
          }
        }
      }
      const final = await client.getTask(taskIdOut).catch(() => null);
      // ClickUp accepts values for fields that are not active in a list but does not store them: verify.
      if (final && setNames.length) {
        const stored = keyFields(final.custom_fields, setNames);
        for (const name of setNames) if (stored[name] === undefined) fieldErrors.push(`${name}: not stored (field not active in ${target.name})`);
      }
      await logActivity(`agent:${agent.id}`, "clickup.task_created", { taskId: taskIdOut, listId: target.id, moved });
      return {
        ok: true,
        message:
          `Task created in ${target.name}${wanted ? ` (${wanted.status})` : ""}.` +
          (moved ? "" : " (Copied — template subtasks/checklists could not be moved.)") +
          (fieldErrors.length ? ` Some fields could not be set: ${fieldErrors.join("; ")}` : ""),
        url: final?.url ?? null,
      };
    }
    case "mission_control_message": {
      const args = schemas.mission_control_message.parse(input.args);
      assertDiscreet(args.text);
      const mc = company?.mission_control_user_id;
      if (!mc) throw new Error("Mission Control is not configured for this company.");
      const a = await account();
      const client = clientFor(a);
      const dm = await client.openDirectMessage(a.teamId!, mc);
      await client.sendChatMessage(a.teamId!, dm.data.id, args.text);
      await logActivity(`agent:${agent.id}`, "clickup.mission_control_message");
      return { ok: true, message: "Message sent to Mission Control." };
    }
    case "playbook_rule": {
      const args = schemas.playbook_rule.parse(input.args);
      const dir = agent.path.split("/").slice(0, -1).join("/");
      const day = stamp();
      const file = args.file === "craft" ? "Craft.md" : "Context.md";
      const title = args.file === "craft" ? "Craft — transferable rules" : `Context — rules specific to ${agent.company}`;
      // A confirmed assumption: drop its "to confirm" line (exact line match only), then append the rule.
      const target = args.replaces?.replace(/^[-*\s]+/, "").replace(/\*/g, "").trim() ?? "";
      if (target.length >= 15) {
        for (const f of ["Context.md", "Craft.md"]) {
          const existing = await readVaultFile(`${dir}/${f}`);
          if (!existing) continue;
          const lines = existing.content.split("\n");
          // Only the FIRST "to confirm" line that contains the text is removed — never other rules.
          const idx = lines.findIndex((l) => /\*to confirm:\*/.test(l) && l.replace(/\*/g, "").includes(target));
          if (idx >= 0) {
            lines.splice(idx, 1);
            await writeVaultFile(`${dir}/${f}`, lines.join("\n"), `${agent.role}: assumption confirmed`, existing.sha);
            break;
          }
        }
      }
      await appendToVault(`${dir}/${file}`, `# ${title}\n`, `- ${args.rule} _(learned ${day})_`, `${agent.role}: learn ${args.file} rule`);
      await appendToVault(`${dir}/Test cases.md`, "# Test cases\n", `- ${args.test_case}`, `${agent.role}: add test case`);
      await appendToVault(`${dir}/Changelog.md`, "# Changelog\n", `- ${day}: ${args.file} rule added — ${args.source}`, `${agent.role}: changelog`);
      await logActivity(`agent:${agent.id}`, "vault.rule_learned", { file: args.file });
      return { ok: true, message: "Learned — the rule is in the playbook." };
    }
    case "meeting_notes": {
      const args = schemas.meeting_notes.parse(input.args);
      const companyDir = company ? company.path.split("/").slice(0, -1).join("/") : "";
      if (!companyDir || args.company_dir !== companyDir) throw new Error("Wrong company for these notes.");
      let path = `${companyDir}/Meeting notes/${args.date} ${args.title.trim()}.md`;
      for (let n = 2; (await readVaultFile(path)) && n < 10; n++) path = `${companyDir}/Meeting notes/${args.date} ${args.title.trim()} (${n}).md`;
      const content = [
        "---",
        "type: meeting-notes",
        `date: ${args.date}`,
        ...(args.client_code ? [`client: ${args.client_code}`] : []),
        "---",
        `# ${args.title.trim()}`,
        "",
        ...(args.summary ? ["## Summary", args.summary.trim(), ""] : []),
        "## Notes",
        args.notes.trim(),
        "",
      ].join("\n");
      await writeVaultFile(path, content, `${agent.role}: meeting notes ${args.date}`);
      await logActivity(`agent:${agent.id}`, "vault.meeting_notes_saved");
      return { ok: true, message: "Saved in your vault (Meeting notes)." };
    }
  }
}
