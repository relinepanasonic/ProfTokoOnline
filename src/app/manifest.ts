import type { MetadataRoute } from "next";

// Next.js file convention: this is auto-served at /manifest.webmanifest with
// the correct application/manifest+json content-type — a static file in
// public/ was getting served with a generic MIME type, which some Android
// browsers treat as invalid and silently fall back to "Create Shortcut"
// instead of the full "Install app" prompt.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Prof Toko Online",
    short_name: "ProfToko",
    description: "Multi-client Shopee sales dashboard",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#091732",
    theme_color: "#091732",
    icons: [
      { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
