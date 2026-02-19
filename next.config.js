
/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'firebasestorage.googleapis.com',
            },
            {
                protocol: 'https',
                hostname: 'picsum.photos',
            }
        ],
    },
    // Add this compiler option
    compiler: {
        // Remove all console.log statements from production builds
        removeConsole: process.env.NODE_ENV === "production",
    },
    // To implement JS obfuscation after build:
    // 1. Install the obfuscator: `npm install --save-dev javascript-obfuscator`
    // 2. Add a `postbuild` script in your `package.json` like this:
    //    "postbuild": "javascript-obfuscator .next/static/chunks --output .next/static/chunks-obfuscated --compact true --self-defending true"
    // 3. You would then need a script to replace the original chunks with the obfuscated ones.
    //    This setup is complex and requires careful configuration to ensure source maps are handled correctly for debugging.
};

module.exports = nextConfig
