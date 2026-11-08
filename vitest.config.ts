import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

config({ path: [".env.local", ".env"], quiet: true });

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

/**
 * Dos grupos: cargas.test.ts publica y retira una versión temporal, así que cambia la "versión vigente" mientras
 * corre. Va en su propio grupo, después de todos los demás (que leen la vigente), para que no se crucen.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "general", include: ["tests/**/*.test.ts"], exclude: ["tests/cargas.test.ts"], environment: "node", sequence: { groupOrder: 0 } },
      },
      {
        resolve: { alias },
        test: { name: "publica-versiones", include: ["tests/cargas.test.ts"], environment: "node", sequence: { groupOrder: 1 } },
      },
    ],
  },
});
