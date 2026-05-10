/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'alvicl.vtexassets.com' },
    ],
  },
};

export default nextConfig;
