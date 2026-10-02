/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // CF_PAGES=1 → static export for Cloudflare Pages (frontend)
  // otherwise → standalone server for Docker (VPS)
  ...(process.env.CF_PAGES
    ? { output: 'export', images: { unoptimized: true } }
    : { output: 'standalone' }),
};

module.exports = nextConfig;
