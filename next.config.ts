import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Se activa cuando el dashboard tenga datos reales y límites de caché definidos.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
