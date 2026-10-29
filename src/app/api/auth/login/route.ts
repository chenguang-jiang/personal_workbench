import { NextRequest, NextResponse } from "next/server";
import { getCloudConfig, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/cloud/config";
import { createSessionToken } from "@/lib/cloud/session";
import { verifyPassword } from "@/lib/cloud/password";
import { LoginThrottle } from "@/lib/cloud/login-throttle";

export const runtime = "nodejs";
const throttle = new LoginThrottle({ maxFailures: 5, windowMs: 15 * 60 * 1000 });

export async function POST(request: NextRequest) {
  const config = getCloudConfig();
  if (!config.isCloud || config.configError) {
    return NextResponse.json({ error: "登录服务尚未配置" }, { status: 503 });
  }
  // 单用户实例共用失败额度，避免伪造代理头绕过限流。
  const client = "single-user";
  const retry = throttle.retryAfterMs(client, Date.now());
  if (retry > 0) {
    return NextResponse.json({ error: "尝试次数过多，请稍后再试" }, {
      status: 429, headers: { "Retry-After": String(Math.ceil(retry / 1000)) },
    });
  }
  const body = await request.json().catch(() => null);
  const password = body?.password;
  if (typeof password !== "string" || password.length > 1024 ||
      !(await verifyPassword(password, config.passwordHash))) {
    throttle.recordFailure(client, Date.now());
    return NextResponse.json({ error: "密码不正确" }, { status: 401 });
  }
  throttle.recordSuccess(client);
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, createSessionToken(config.sessionSecret, Date.now(), SESSION_TTL_MS), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}
