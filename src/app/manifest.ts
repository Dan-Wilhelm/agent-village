import type { MetadataRoute } from "next";

/** Installable desktop/mobile app (PWA). No offline data: everything stays live. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agent Village",
    short_name: "Village",
    description: "Your cozy village of agents that bring you your work.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6e7cf",
    theme_color: "#f6e7cf",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
