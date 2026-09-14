import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pi SDK 依赖 Node 原生能力和动态加载资源，必须由服务端 Node 直接加载。
  serverExternalPackages: ["@earendil-works/pi-coding-agent"],
  // 固定到当前应用，避免父目录中的 lockfile 被误判为工作区根目录。
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
