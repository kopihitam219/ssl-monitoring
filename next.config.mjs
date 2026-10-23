/** @type {import('next').NextConfig} */
const nextConfig = {
  // dijalankan oleh Node.js langsung (tidak di-bundle)
  serverExternalPackages: ['xlsx', 'postgres', '@electric-sql/pglite', 'nodemailer'],
  poweredByHeader: false,
};

export default nextConfig;
