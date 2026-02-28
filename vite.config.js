import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "pwa-192x192.png",
        "pwa-512x512.png",
        "apple-touch-icon.png"
      ],
      manifest: {
        name: "Network Medic SG",
        short_name: "Network Medic",
        description:
          "Diagnose why mobile data isn't working even with signal bars (SG carriers).",
        theme_color: "#09090b",
        background_color: "#09090b",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      // Keep diagnostics “live-only”: do NOT add runtime caching for external endpoints.
      workbox: {
        runtimeCaching: []
      }
    })
  ]
});