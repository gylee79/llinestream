import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
    ],
  },
  experimental: {
    allowedDevOrigins: [
      "http://localhost:9002",
      ".cloudworkstations.dev",
    ],
  },
};

export default nextConfig;
