import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({ test: { include: ["tests/**/*.test.ts"], environment: "node" } });
