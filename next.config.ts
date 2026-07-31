import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/admin/migrate": ["./db/migrations/**"],
  },
};

export default nextConfig;
