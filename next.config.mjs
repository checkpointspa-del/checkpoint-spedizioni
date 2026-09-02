/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        // L'app vive dentro l'Admin Shopify: deve poter essere incorniciata solo da Shopify.
        { key: 'Content-Security-Policy',
          value: "frame-ancestors https://admin.shopify.com https://*.myshopify.com;" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
      ]
    }];
  }
};
export default nextConfig;
