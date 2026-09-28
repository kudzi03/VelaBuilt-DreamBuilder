import type { NextConfig } from "next";

/**
 * Content-Security-Policy. Everything the demo loads is same-origin (fonts are self-hosted,
 * 3D assets live in /public, analytics is Vercel's first-party /_vercel/insights).
 * - 'unsafe-inline' scripts: Next's inline bootstrap and the JSON-LD block (no nonce pipeline yet)
 * - 'wasm-unsafe-eval': the meshopt decoder compiles WebAssembly for the plant and prop models
 * - blob:/data: images and fetches: GLTF textures and the procedural textures
 * - Cloudflare Turnstile hosts only when a site key is configured
 * - vercel.live only on preview deployments (Vercel's comment toolbar)
 */
const turnstile = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? " https://challenges.cloudflare.com" : "";
const preview = process.env.VERCEL_ENV === "preview" ? " https://vercel.live https://*.pusher.com wss://*.pusher.com" : "";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${turnstile}${preview}`,
  `style-src 'self' 'unsafe-inline'${preview}`,
  `img-src 'self' data: blob:${preview}`,
  `font-src 'self' data:${preview}`,
  `connect-src 'self' blob: data:${turnstile}${preview}`,
  "worker-src 'self' blob:",
  `frame-src${turnstile || preview ? `${turnstile}${preview}` : " 'none'"}`,
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), browsing-topics=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  productionBrowserSourceMaps: false,
  transpilePackages: ["three"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // skies, textures, props, plant atlases: large and rarely changed
        source: "/assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }],
      },
    ];
  },
};

export default nextConfig;
