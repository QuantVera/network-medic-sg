import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Inject the SW register script into index.html automatically
      injectRegister: "auto",

      // When a new SW is available, update in the background and activate ASAP
      registerType: "autoUpdate",

      // Helps ensure new SW controls pages quickly
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,

        // IMPORTANT: keep probes live-only
        runtimeCaching: [],
      },

      includeAssets: [
        "pwa-192x192.png",
        "pwa-512x512.png",
        "apple-touch-icon.png",
      ],

      manifest: {
        name: "Network Medic",
        short_name: "Network Medic",
        description:
          "Diagnose why mobile data isn't working even with signal bars (privacy-first, client-only).",
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
            purpose: "maskable",
          },
        ],
      },

      // During local dev, don't register SW (avoids confusing cache issues)
      devOptions: {
        enabled: false,
      },
    }),
  ],
});