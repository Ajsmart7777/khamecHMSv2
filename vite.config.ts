import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "child_process";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const commitHash = execSync('git rev-parse --short HEAD || echo "dev"')
    .toString()
    .trim();

  return {
    define: {
      'process.env.VITE_APP_COMMIT_HASH': JSON.stringify(commitHash),
      'process.env.VITE_APP_VERSION': JSON.stringify('1.4.2'),
    },
    server: {
      host: "::",
      port: 8080,
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.ico", "pwa-icon-192.png", "pwa-icon-512.png"],
        manifest: {
          name: "Khadija Medical Center HMS",
          short_name: "KMC HMS",
          description: "Hospital Management System for Khadija Medical Center Funtua",
          theme_color: "#16a34a",
          background_color: "#ffffff",
          display: "standalone",
          orientation: "portrait",
          scope: "/",
          start_url: "/",
          icons: [
            {
              src: "/pwa-icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "/pwa-icon-512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "/pwa-icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          navigateFallbackDenylist: [/^\/~oauth/],
          globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime"],
    },
  };
});