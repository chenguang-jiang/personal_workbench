import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 开发服务器默认只认 localhost。用 127.0.0.1 或临时预览域名打开时，
  // 客户端脚本会被 403，阅读页无法水合，字号和文内链接点击都不会生效。
  allowedDevOrigins: ["127.0.0.1", "*.trycloudflare.com"],
  // Pi SDK 依赖 Node 原生能力和动态加载资源，必须由服务端 Node 直接加载。
  serverExternalPackages: ["@earendil-works/pi-coding-agent"],
  // 固定到当前应用，避免父目录中的 lockfile 被误判为工作区根目录。
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
