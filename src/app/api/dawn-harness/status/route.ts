import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** DeepSeek harness 本地服务地址 */
export const DAWN_HARNESS_URL = "http://127.0.0.1:3080";

/** GET /api/dawn-harness/status — 服务端探测 harness 是否在线 */
export async function GET() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(DAWN_HARNESS_URL, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    return NextResponse.json({
      online: response.ok || response.status < 500,
      status: response.status,
      url: DAWN_HARNESS_URL,
    });
  } catch {
    return NextResponse.json({ online: false, status: null, url: DAWN_HARNESS_URL });
  }
}
