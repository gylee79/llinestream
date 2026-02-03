
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
    serverExternalPackages: [
      "genkit",
      "@genkit-ai/firebase",
      "@genkit-ai/google-genai",
      "firebase-admin",
    ],
  },
  images: {
    remotePatterns: [
      // Allow images from Unsplash
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "unsplash.com",
      },
      // Allow placeholder images
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      // Allow images from Firebase Storage
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
      {
        protocol: "https" ,
        hostname: "storage.googleapis.com",
      },
    ],
  },
  webpack(config) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};

module.exports = nextConfig;
