import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_ENV:
      process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? "",
  },
  allowedDevOrigins: ["127.0.0.1"],
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/client-metadata.json",
          destination: "/api/oauth/web-client-metadata",
        },
      ],
    };
  },
  async headers() {
    return [
      {
        source: "/client-metadata.json",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
