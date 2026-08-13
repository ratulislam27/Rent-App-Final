import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rento — Landlord Rent Management",
    short_name: "Rento",
    description: "Manage properties, tenants, agreements, rent receipts and expenses.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f5f6f8",
    theme_color: "#f5f6f8",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icon-192-v2.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512-v2.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
