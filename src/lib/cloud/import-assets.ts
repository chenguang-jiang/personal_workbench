import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getVaultConfig } from "@/lib/obsidian-sync";
import { IMPORT_INBOX } from "./import-plan";

/**
 * 对话导入的图片附件：写入 vault 的导入收件箱 assets 目录，
 * 生成的文章用 ![[文件名]] 引用，阅读器与分享页都能直接渲染。
 */

export const IMPORT_ASSETS_DIR = `${IMPORT_INBOX}/assets`;

/** 单张图片上限 4MB（base64 前）；每轮最多 4 张 */
export const ATTACH_MAX_BYTES = 4 * 1024 * 1024;
export const ATTACH_MAX_COUNT = 4;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
};

export type AttachedImage = { name: string; ref: string; bytes: number };

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const matched = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!matched) return null;
  const buffer = Buffer.from(matched[2].replace(/\s+/g, ""), "base64");
  if (buffer.length === 0 || buffer.length > ATTACH_MAX_BYTES) return null;
  return { mime: matched[1], buffer };
}

/** 附件文件名只允许本模块生成的形状，杜绝路径穿越 */
const ATTACH_NAME = /^导入附图-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.(png|jpg|gif|webp|bmp)$/;

export function isAttachedImageName(name: string): boolean {
  return ATTACH_NAME.test(name);
}

/** 读回已保存的附件为 data URL（供视觉模型使用）；不存在或越界返回 null */
export function loadAttachedImage(name: string): string | null {
  if (!isAttachedImageName(name)) return null;
  const { available, vaultPath } = getVaultConfig();
  if (!available) return null;
  const file = path.join(vaultPath, ...IMPORT_ASSETS_DIR.split("/"), name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  const buffer = fs.readFileSync(file);
  if (buffer.length > ATTACH_MAX_BYTES) return null;
  const mime = name.endsWith(".png") ? "image/png"
    : name.endsWith(".gif") ? "image/gif"
    : name.endsWith(".webp") ? "image/webp"
    : name.endsWith(".bmp") ? "image/bmp"
    : "image/jpeg";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/** 把 data URL 图片写入 vault assets 目录，返回可嵌入 Markdown 的引用 */
export function saveAttachedImages(images: string[]): AttachedImage[] {
  const { available, vaultPath } = getVaultConfig();
  if (!available) throw new Error("知识库目录不可用，无法保存图片");
  const dir = path.join(vaultPath, ...IMPORT_ASSETS_DIR.split("/"));
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  const saved: AttachedImage[] = [];
  for (const dataUrl of images) {
    const parsed = parseDataUrl(dataUrl);
    const ext = parsed ? MIME_TO_EXT[parsed.mime] : undefined;
    if (!parsed || !ext) throw new Error("仅支持 PNG / JPG / GIF / WebP / BMP 图片，单张不超过 4MB");
    const name = `导入附图-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}${ext}`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, parsed.buffer, { flag: "wx", mode: 0o640 });
    saved.push({ name, ref: `![[${name}]]`, bytes: parsed.buffer.length });
  }
  return saved;
}
