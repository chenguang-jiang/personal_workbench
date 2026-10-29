import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getVaultConfig } from "@/lib/obsidian-sync";
import { findVaultAssetByName } from "@/lib/vault-asset-index";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

/** 从文章 Markdown 中提取所有被引用的图片（![](src) 与 ![[embed]]），作为公开资源的白名单 */
function allowedImageRefs(content: string): Set<string> {
  const refs = new Set<string>();
  for (const match of content.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    const src = match[2].split(/\s+/)[0].trim().replace(/^\.?\//, "");
    if (src) refs.add(src);
  }
  for (const match of content.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    const clean = match[1].trim();
    if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(clean)) refs.add(clean);
  }
  return refs;
}

// GET /api/share/[token]/asset?path=… — 免登录，但只能取该分享文章正文里引用到的图片
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const article = await prisma.article.findUnique({
    where: { shareToken: token },
    select: { content: true },
  });
  if (!article) {
    return NextResponse.json({ error: "分享不存在或已关闭" }, { status: 404 });
  }

  const raw = req.nextUrl.searchParams.get("path")?.trim() || "";
  if (!raw) return NextResponse.json({ error: "path 必填" }, { status: 400 });

  const ext = path.extname(raw).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return NextResponse.json({ error: "不支持的资源类型" }, { status: 415 });
  }

  const normalized = path.normalize(raw).replace(/^[/\\]+/, "");
  if (normalized.split(path.sep).some((part) => part.startsWith("."))) {
    return NextResponse.json({ error: "非法路径" }, { status: 400 });
  }

  // 白名单：路径精确命中，或文件名命中（Obsidian 嵌入只写文件名，实际位置由索引解析）
  const refs = allowedImageRefs(article.content ?? "");
  const basename = path.basename(normalized);
  const allowed =
    refs.has(normalized) ||
    refs.has(raw.trim().replace(/^\.?\//, "")) ||
    [...refs].some((ref) => path.basename(ref) === basename);
  if (!allowed) {
    return NextResponse.json({ error: "资源不在分享范围内" }, { status: 403 });
  }

  const { available, vaultPath } = getVaultConfig();
  if (!available) {
    return NextResponse.json({ error: "vault 不可用" }, { status: 503 });
  }

  let filePath = path.join(vaultPath, normalized);
  const relative = path.relative(vaultPath, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return NextResponse.json({ error: "非法路径" }, { status: 400 });
  }

  if (
    !fs.existsSync(/* turbopackIgnore: true */ filePath) ||
    !fs.statSync(/* turbopackIgnore: true */ filePath).isFile()
  ) {
    const found = await findVaultAssetByName(vaultPath, basename);
    if (!found) return NextResponse.json({ error: "资源不存在" }, { status: 404 });
    filePath = found;
  }

  // 解析符号链接后再校验仍在 vault 内，防止 vault 内的软链指向外部文件
  let realFile: string;
  try {
    const realRoot = fs.realpathSync(/* turbopackIgnore: true */ vaultPath);
    realFile = fs.realpathSync(/* turbopackIgnore: true */ filePath);
    const realRelative = path.relative(realRoot, realFile);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      return NextResponse.json({ error: "非法路径" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "资源不存在" }, { status: 404 });
  }

  try {
    const data = fs.readFileSync(/* turbopackIgnore: true */ realFile);
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      // 分享文章可能更新，图片不做长缓存
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    };
    if (ext === ".svg") {
      headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    }
    return new NextResponse(new Uint8Array(data), { headers });
  } catch (error) {
    console.error("[share/asset] 读取失败:", error);
    return NextResponse.json({ error: "资源读取失败" }, { status: 500 });
  }
}
