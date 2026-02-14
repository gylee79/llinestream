/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      'genkit',
      '@genkit-ai/google-genai',
      '@genkit-ai/firebase',
    ],
  },
};

export default nextConfig;
