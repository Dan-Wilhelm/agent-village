import "server-only";

import { listVaultFiles, readVaultFile, writeVaultFile } from "@/integrations/vault/github";

import { parseNote, updateFields } from "./frontmatter";
import {
  agentProfileSchema,
  classifyVaultPath,
  companySchema,
  teamSchema,
  type AgentProfile,
  type CompanyProfile,
  type TeamProfile,
} from "./schema";

export interface AgentEntry extends AgentProfile {
  path: string;
  /** Mission + routing text from the note body (used by the dispatcher). */
  description: string;
}

export interface Registry {
  companies: Array<CompanyProfile & { path: string }>;
  teams: Array<TeamProfile & { path: string }>;
  agents: AgentEntry[];
  /** Notes that could not be read or validated (shown to the owner, never fatal). */
  problems: Array<{ path: string; message: string }>;
}

let cache: { at: number; value: Registry } | null = null;
const TTL_MS = 30_000;

/** Loads companies, teams and agents from the vault. Vault content is not ClickUp data, so a short cache is fine. */
export async function loadRegistry({ fresh = false } = {}): Promise<Registry> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const paths = await listVaultFiles();
  const relevant = paths.map((p) => ({ p, c: classifyVaultPath(p) })).filter((x) => x.c !== null);
  const files = await Promise.all(relevant.map(async ({ p }) => ({ p, file: await readVaultFile(p) })));

  const registry: Registry = { companies: [], teams: [], agents: [], problems: [] };
  for (const { p, file } of files) {
    const kind = classifyVaultPath(p)!;
    if (!file) continue;
    const note = parseNote(file.content);
    if (kind.kind === "company") {
      const r = companySchema.safeParse(note.data);
      if (r.success) registry.companies.push({ ...r.data, path: p });
      else registry.problems.push({ path: p, message: r.error.issues[0]?.message ?? "invalid company" });
    } else if (kind.kind === "team") {
      const r = teamSchema.safeParse(note.data);
      if (r.success) registry.teams.push({ ...r.data, path: p });
      else registry.problems.push({ path: p, message: r.error.issues[0]?.message ?? "invalid team" });
    } else {
      const r = agentProfileSchema.safeParse(note.data);
      if (r.success) {
        registry.agents.push({ ...r.data, path: p, description: note.body.trim().slice(0, 2000) });
      } else {
        const issue = r.error.issues[0];
        registry.problems.push({ path: p, message: `${issue?.path.join(".") || "profile"}: ${issue?.message ?? "invalid"}` });
      }
    }
  }
  const ids = new Set<string>();
  registry.agents = registry.agents.filter((a) => {
    if (ids.has(a.id)) {
      registry.problems.push({ path: a.path, message: `duplicate agent id ${a.id}` });
      return false;
    }
    ids.add(a.id);
    return true;
  });
  cache = { at: Date.now(), value: registry };
  return registry;
}

/** Renames an agent: only the display name in its profile changes (folders are named by role). */
export async function renameAgent(agentId: string, newName: string) {
  const name = newName.trim();
  if (!name || name.length > 40) throw new Error("Please choose a name with 1–40 characters.");
  const registry = await loadRegistry({ fresh: true });
  const agent = registry.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error("Unknown agent.");
  const file = await readVaultFile(agent.path);
  if (!file) throw new Error("Agent profile not found.");
  await writeVaultFile(agent.path, updateFields(file.content, { name }), `Rename ${agent.role}: ${agent.name} → ${name}`, file.sha);
  cache = null;
  return { id: agentId, name };
}

/** Marks an agent as introduced (after its first real conversation with the owner). */
export async function markIntroduced(agentId: string) {
  const registry = await loadRegistry({ fresh: true });
  const agent = registry.agents.find((a) => a.id === agentId);
  if (!agent || agent.introduced) return;
  const file = await readVaultFile(agent.path);
  if (!file) return;
  await writeVaultFile(agent.path, updateFields(file.content, { introduced: true }), `${agent.role}: introduced`, file.sha);
  cache = null;
}
