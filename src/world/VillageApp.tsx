"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";

import { Hud } from "@/ui/Hud";
import { InteractionPanel } from "@/ui/InteractionPanel";
import { LoadingScreen } from "@/ui/LoadingScreen";

import { startDemo } from "./demo";

// WebGL + WASM physics only run in the browser.
const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => <LoadingScreen label="Building the village…" />,
});

export function VillageApp({ ownerName }: { ownerName: string }) {
  useEffect(() => startDemo(), []);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <Scene />
      <Hud ownerName={ownerName} />
      <InteractionPanel />
    </div>
  );
}
