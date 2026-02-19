
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
    compiler: {
        // Remove all console.log statements from production builds
        removeConsole: process.env.NODE_ENV === "production",
    },
    // To implement JS obfuscation after build:
    // 1. Install the obfuscator: `npm install --save-dev javascript-obfuscator`
    // 2. Add a `postbuild` script in your `package.json` like this:
    //    "postbuild": "javascript-obfuscator .next --output .next-obfuscated --compact true --self-defending true"
    //    (Note: The output path needs careful handling to replace original files, this is just an example)
};

module.exports = nextConfig
    