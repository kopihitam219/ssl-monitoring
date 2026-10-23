/** @type {import('next').NextConfig} */
const nextConfig = {
  // dijalankan oleh Node.js langsung (bukan di-bundle) supaya node:sqlite aman
  serverExternalPackages: ['xlsx'],
  poweredByHeader: false,
};

export default nextConfig;
