import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Future of Contractor Sales — VelaBuilt",
    short_name: "VelaBuilt Demo",
    description: "Interactive demo by VelaBuilt: customers explore, configure and price their project, then book — before they ever call.",
    start_url: "/?ref=pwa",
    display: "standalone",
    background_color: "#f4f1ec",
    theme_color: "#f4f1ec",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
