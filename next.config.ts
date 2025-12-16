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
    // 👇 아래 주석을 달면 빨간 줄이 사라지고 정상 작동합니다.
    // @ts-ignore
    allowedDevOrigins: [
      "localhost:9002",
      ".cloudworkstations.dev",
    ],
  },
};

export default nextConfig;
