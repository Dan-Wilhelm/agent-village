import "server-only";

import { z } from "zod";

import { clientFor, getClickUpAccount } from "@/integrations/clickup/account";
import { readVaultFile, writeVaultFile } from "@/integrations/vault/github";
import { logActivity } from "@/lib/activity";

import { assertDiscreet } from "./discretion";
import { loadRegistry, type AgentEntry } from "./registry";
import type { ProposalKind } from "./tools";

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
  draft_task: z.object({ draft_task_id: taskId, target_list_id: taskId }),
  mission_control_message: z.object({ text: z.string().min(1).max(3000) }),
  playbook_rule: z.object({
    file: z.enum(["craft", "context"]),
    rule: z.string().min(5).max(1200),
    test_case: z.string().min(5).max(800),
    source: z.string().max(400),
  }),
} satisfies Record<ProposalKind, z.ZodTypeAny>;

const PERMISSION: Record<ProposalKind, string | null> = {
  comment: "propose_comment",
  task_change: "propose_change",
  draft_task: "draft_task",
  mission_control_message: "message_mission_control",
  playbook_rule: null,
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

  // Rejection only needs cleanup for drafts (they already live in the drafts list).
  if (input.decision === "reject") {
    if (input.kind === "draft_task") {
      const args = schemas.draft_task.parse(input.args);
      const { a } = await assertTaskAllowed(args.draft_task_id);
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
      const target = await client.getList(args.target_list_id);
      if (!a.selectedSpaceIds.includes(target.space.id)) throw new Error("Target list is outside the allowed spaces.");
      const text = draft.markdown_description ?? draft.text_content ?? "";
      assertDiscreet(`${draft.name}\n${text}`);
      const created = await client.createTask(args.target_list_id, {
        name: draft.name,
        markdown_content: text,
        ...(draft.due_date ? { due_date: draft.due_date } : {}),
        ...(draft.priority?.id ? { priority: Number(draft.priority.id) } : {}),
      });
      await client.deleteTask(args.draft_task_id);
      await logActivity(`agent:${agent.id}`, "clickup.task_created", { taskId: created.id, listId: args.target_list_id });
      return { ok: true, message: "Task created.", url: created.url ?? null };
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
      await appendToVault(`${dir}/${file}`, `# ${title}\n`, `- ${args.rule} _(learned ${day})_`, `${agent.role}: learn ${args.file} rule`);
      await appendToVault(`${dir}/Test cases.md`, "# Test cases\n", `- ${args.test_case}`, `${agent.role}: add test case`);
      await appendToVault(`${dir}/Changelog.md`, "# Changelog\n", `- ${day}: ${args.file} rule added — ${args.source}`, `${agent.role}: changelog`);
      await logActivity(`agent:${agent.id}`, "vault.rule_learned", { file: args.file });
      return { ok: true, message: "Learned — the rule is in the playbook." };
    }
  }
}
