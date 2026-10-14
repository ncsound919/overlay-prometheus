import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PROMETHEUS — Autonomous Discovery Engine",
    short_name: "PROMETHEUS",
    description:
      "Mission-control dashboard for an autonomous scientific discovery engine — 8-layer inference stack, breakthrough synthesis, governance and live telemetry.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/prometheus-icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
