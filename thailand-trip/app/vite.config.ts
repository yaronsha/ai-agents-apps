import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // In production a Pages Function passes /api to the worker; locally, `npm run dev:worker` runs it on 8787.
  server: { proxy: { "/api": "http://localhost:8787" } },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,woff2}"] },
      manifest: {
        name: "צפון תאילנד 2026",
        short_name: "צפון תאילנד",
        lang: "he",
        dir: "rtl",
        start_url: "/",
        display: "standalone",
        background_color: "#e9efea",
        theme_color: "#e9efea",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
