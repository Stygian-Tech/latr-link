import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["latr-packages"],
  async rewrites() {
    return [
      {
        source: "/client-metadata.json",
        destination: "/api/oauth/client-metadata",
      },
    ];
  },
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
