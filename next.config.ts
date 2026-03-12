import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: isDevelopment ? ".next-dev" : "build"
};

export default nextConfig;
