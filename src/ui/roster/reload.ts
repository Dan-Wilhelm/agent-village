"use client";

import { getRoster } from "@/app/actions/agents";
import { syncAgents } from "@/world/director";

import { useRoster } from "./store";

/** Loads the roster from the vault and syncs the 3D world (new agents appear, archived ones leave). */
export async function reloadRoster() {
  const r = await getRoster();
  useRoster.getState().set({ agents: r.agents, teams: r.teams, problems: r.problems });
  syncAgents(r.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, look: a.look, home: a.home, priority: a.priority })));
  return r;
}
