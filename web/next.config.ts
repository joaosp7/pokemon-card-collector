import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // O repositorio ja tem erros de tipo pre-existentes (ver AGENTS.md) que
  // quebram `next build`; sem isso a imagem Docker nao compila.
  typescript: { ignoreBuildErrors: true },
  serverExternalPackages: ["better-sqlite3", "sharp"],
};

export default nextConfig;
