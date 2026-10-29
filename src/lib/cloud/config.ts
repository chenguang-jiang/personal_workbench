import { MIN_SECRET_LENGTH } from "./session";

export const SESSION_COOKIE = "dawnkb_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CloudConfig = {
  isCloud: boolean;
  sessionSecret: string;
  passwordHash: string;
  /** 云端模式下缺少必要配置时的说明；有值即应拒绝所有请求 */
  configError: string | null;
};

/** DAWNKB_MODE=cloud 时启用云端只读模式与登录；其他值保持本机模式。 */
export function getCloudConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig {
  const isCloud = env.DAWNKB_MODE === "cloud";
  const sessionSecret = env.DAWNKB_SESSION_SECRET ?? "";
  const passwordHash = env.DAWNKB_PASSWORD_HASH ?? "";

  let configError: string | null = null;
  if (isCloud && sessionSecret.length < MIN_SECRET_LENGTH) {
    configError = `DAWNKB_SESSION_SECRET 未设置或少于 ${MIN_SECRET_LENGTH} 个字符`;
  } else if (isCloud && !passwordHash.startsWith("scrypt$")) {
    configError = "DAWNKB_PASSWORD_HASH 未设置（用 npm run auth:hash 生成）";
  }

  return { isCloud, sessionSecret, passwordHash, configError };
}

export function isCloudMode(): boolean {
  return getCloudConfig().isCloud;
}
