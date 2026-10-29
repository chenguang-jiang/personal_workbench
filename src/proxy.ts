import { NextResponse, type NextRequest } from "next/server";
import { decideCloudAccess } from "@/lib/cloud/access-policy";
import { getCloudConfig, SESSION_COOKIE } from "@/lib/cloud/config";
import { verifySessionToken } from "@/lib/cloud/session";

// 本机模式（默认）：没有登录体系，API（含写入 Vault）只接受本机的同源请求。
// 云端模式（DAWNKB_MODE=cloud）：允许远程访问，但所有页面和 API 都要先登录，写操作只放行明确的白名单。
// 两种模式都挡跨站 POST（CSRF）。
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostname(host: string | null): string {
  if (!host) return "";
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

function isLoopbackHost(request: NextRequest): boolean {
  return LOOPBACK_HOSTS.has(hostname(request.headers.get("host")));
}

function isSameOrigin(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";
  const origin = request.headers.get("origin");
  // 非浏览器客户端（curl、脚本）不带 Origin：本机模式由 Host 回环检查兜底，云端模式由登录兜底
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function localProxy(request: NextRequest) {
  if (!isApiPath(request.nextUrl.pathname)) return NextResponse.next();
  if (!isLoopbackHost(request) && process.env.DAWNKB_ALLOW_REMOTE !== "1") {
    return jsonError("仅允许本机访问 DawnKB API（如需局域网访问请设置 DAWNKB_ALLOW_REMOTE=1）", 403);
  }
  if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
    return jsonError("拒绝跨站请求", 403);
  }
  return NextResponse.next();
}

function cloudProxy(request: NextRequest) {
  const config = getCloudConfig();
  const { pathname, search } = request.nextUrl;
  // 自托管反向代理后的 request.url 可能仍是容器地址。
  const publicBaseUrl = process.env.DAWNKB_PUBLIC_URL || request.url;

  if (config.configError) {
    console.error(`[proxy] 云端模式配置不完整：${config.configError}`);
    return jsonError("云端模式未完成配置，请检查服务器环境变量", 503);
  }
  if (isApiPath(pathname) && !SAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
    return jsonError("拒绝跨站请求", 403);
  }

  const isAuthenticated = verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
    config.sessionSecret,
    Date.now(),
  );
  const decision = decideCloudAccess(request.method, pathname, { isAuthenticated });

  switch (decision.kind) {
    case "allow":
      return NextResponse.next();
    case "unauthorized":
      return jsonError("请先登录", 401);
    case "forbidden":
      return jsonError(decision.message, 403);
    case "redirect-home":
      return NextResponse.redirect(new URL("/dashboard", publicBaseUrl));
    case "redirect-login": {
      const loginUrl = new URL("/login", publicBaseUrl);
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(loginUrl);
    }
  }
}

export function proxy(request: NextRequest) {
  return getCloudConfig().isCloud ? cloudProxy(request) : localProxy(request);
}

export const config = {
  // 页面与 API 都经过这里；只跳过构建产物与图片优化（不含用户数据）
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
