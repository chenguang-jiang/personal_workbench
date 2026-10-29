import { createHmac, timingSafeEqual } from "node:crypto";

// 单用户会话：cookie 里只放「版本.过期时间.签名」，不存任何用户数据。
// 更换 DAWNKB_SESSION_SECRET 即可让所有已登录设备失效。
const TOKEN_VERSION = "v1";
export const MIN_SECRET_LENGTH = 32;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(secret: string, nowMs: number, ttlMs: number): string {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`会话密钥至少需要 ${MIN_SECRET_LENGTH} 个字符`);
  }
  const payload = `${TOKEN_VERSION}.${nowMs + ttlMs}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, nowMs: number): boolean {
  if (!token || secret.length < MIN_SECRET_LENGTH) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expiresRaw, signature] = parts;
  if (version !== TOKEN_VERSION || !/^\d+$/.test(expiresRaw) || !signature) return false;

  const expected = Buffer.from(sign(`${version}.${expiresRaw}`, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

  return Number(expiresRaw) > nowMs;
}
