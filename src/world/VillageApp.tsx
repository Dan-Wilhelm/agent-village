"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";

import { Hud } from "@/ui/Hud";
import { LoadingScreen } from "@/ui/LoadingScreen";
import { registerServiceWorker } from "@/ui/push";
import { startVisitPolling } from "@/ui/visits";
import { reloadRoster } from "@/ui/roster/reload";


// WebGL + WASM physics only run in the browser.
const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => <LoadingScreen label="Building the village…" />,
});

export function VillageApp({ ownerName }: { ownerName: string }) {
  // The real agents come from the vault (settings only — no ClickUp content).
  // Visits from triggers are picked up once the agents exist in the world.
  useEffect(() => {
    let cancelled = false;
    let stopPolling: (() => void) | null = null;
    void registerServiceWorker()?.catch(() => null);
    reloadRoster()
      .then(() => {
        if (cancelled) return;
        stopPolling = startVisitPolling();
      })
      .catch(() => {
        /* the HUD shows an empty roster; the world still works */
      });
    return () => {
      cancelled = true;
      stopPolling?.();
    };
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <Scene />
      <Hud ownerName={ownerName} />
    </div>
  );
}
