import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only trace/bundle the specific recharts submodules each file actually
  // imports, instead of pulling the whole package's module graph into every
  // chunk that touches it.
  experimental: {
    optimizePackageImports: ["recharts"],
  },
};

export default nextConfig;
