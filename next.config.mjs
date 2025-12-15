/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 15: flyttet fra experimental.serverComponentsExternalPackages
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
