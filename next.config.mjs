import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // dijalankan oleh Node.js langsung (tidak di-bundle)
  serverExternalPackages: ['xlsx', 'postgres', '@electric-sql/pglite', 'nodemailer'],
  poweredByHeader: false,
  // versi diambil dari package.json saat build, supaya label di sidebar tidak perlu diubah manual
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
};

export default nextConfig;
