import { NextResponse } from "next/server";

/**
 * 读取 JSON 请求体，只接受普通对象。
 * 空体、非法 JSON、数组或原始值都返回 null，由调用方统一回 400，
 * 避免 `await req.json()` 直接抛出变成未处理的 500。
 * T 只是类型断言，字段请声明为可选并在使用前校验。
 */
export async function readJsonObject<T extends object = Record<string, unknown>>(
  req: Request,
): Promise<T | null> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as T;
}

export function invalidJsonResponse() {
  return NextResponse.json({ error: "请求内容不是有效 JSON 对象" }, { status: 400 });
}
