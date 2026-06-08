/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the client-side router cache warm so re-visiting a page within a short
  // window (e.g. tapping back to a tab you just saw) is instant rather than a
  // fresh fetch. Mutations via server actions still call revalidatePath, which
  // clears the cache for affected routes, so logged data shows immediately.
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },
  async headers() {
    return [
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Content-Type', value: 'application/manifest+json' }],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
