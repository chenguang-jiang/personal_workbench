import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// 存储格式：scrypt$N$r$p$salt$hash（salt 与 hash 为 base64url）
const SCHEME = "scrypt";
const DEFAULT_PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;
// N=2^15、r=8 需要约 32MB 内存，默认上限 32MB 不够用
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, params: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { ...params, maxmem: MAX_MEMORY_BYTES }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("密码不能为空");
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, DEFAULT_PARAMS);
  const { N, r, p } = DEFAULT_PARAMS;
  return [SCHEME, N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== SCHEME) return false;

  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length === 0 || expected.length !== KEY_BYTES) return false;

  try {
    const actual = await derive(password, salt, { N, r, p });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
