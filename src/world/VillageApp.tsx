"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";

import { getRoster } from "@/app/actions/agents";
import { Hud } from "@/ui/Hud";
import { LoadingScreen } from "@/ui/LoadingScreen";
import { useRoster } from "@/ui/roster/store";

import { syncAgents } from "./director";

// WebGL + WASM physics only run in the browser.
const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => <LoadingScreen label="Building the village…" />,
});

export function VillageApp({ ownerName }: { ownerName: string }) {
  // The real agents come from the vault (settings only — no ClickUp content).
  useEffect(() => {
    let cancelled = false;
    getRoster()
      .then((r) => {
        if (cancelled) return;
        useRoster.getState().set({ agents: r.agents, teams: r.teams, problems: r.problems });
        syncAgents(r.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, look: a.look, home: a.home, priority: a.priority })));
      })
      .catch(() => {
        /* the HUD shows an empty roster; the world still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <Scene />
      <Hud ownerName={ownerName} />
    </div>
  );
}
