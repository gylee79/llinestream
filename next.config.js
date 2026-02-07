
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
    serverComponentsExternalPackages: [
      "genkit",
      "@genkit-ai/firebase",
      "@genkit-ai/google-genai",
      "firebase-admin",
      "@google-cloud/firestore",
      "@google-cloud/storage",
      "@google-cloud/aiplatform",
      "@grpc/grpc-js",
      "long",
      "@opentelemetry/instrumentation",
      "@opentelemetry/sdk-node",
      "require-in-the-middle",
      "express",
    ],
  },
  images: {
    remotePatterns: [
      // Allow images from Unsplash
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "unsplash.com",
        pathname: "**",
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
};

module.exports = nextConfig;
