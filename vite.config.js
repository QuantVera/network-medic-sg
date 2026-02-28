import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Simple build version for debugging + helping you confirm deploy freshness
const buildVersion = new Date().toISOString();

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Ensures the registration script checks and updates SW automatically
      registerType: "autoUpdate",

      // Make sure SW is generated (default), and keep it in root scope
      scope: "/",
      base: "/",

      // If you want your icons copied from /public, list them here
      includeAssets: [
        "pwa-192x192.png",
        "pwa-512x512.png",
        "apple-touch-icon.png",
      ],

      manifest: {
        name: "Network Medic",
        short_name: "Network Medic",
        description:
          "Diagnose why mobile data isn't working even with signal bars (privacy-first).",
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

      // Workbox config: fast updates + no external endpoint caching
      workbox: {
        // Important: activate new SW ASAP
        skipWaiting: true,
        clientsClaim: true,

        // Prevent stale caches accumulating
        cleanupOutdatedCaches: true,

        // Keep external diagnostics live-only: DO NOT runtime-cache anything
        runtimeCaching: [],

        // Optional: avoid caching navigation aggressively
        // (Cloudflare Pages + PWA can be sticky if you cache HTML)
        navigateFallback: "/index.html",
      },

      // Helpful in dev: enables SW in dev if you want to test install/update behavior locally.
      // If you don't need dev SW, set enabled: false.
      devOptions: {
        enabled: false,
      },
    }),
  ],

  // Lets you print app version in UI/console: console.log(__APP_VERSION__)
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion),
  },
});