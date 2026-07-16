import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

function normalizeBase(value) {
  if (!value || value === "/") return "";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

const base = normalizeBase(process.env.BASE_PATH ?? "/game_wall");
const site = process.env.SITE_URL ?? "https://example.github.io";

export default defineConfig({
  site,
  base,
  output: "static",
  trailingSlash: "always",
  integrations: [sitemap()],
  build: {
    assets: "assets"
  },
  vite: {
    build: {
      chunkSizeWarningLimit: 600
    }
  }
});
