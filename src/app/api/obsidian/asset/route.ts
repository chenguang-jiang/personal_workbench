import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
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

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("path")?.trim() || "";
  if (!raw) return NextResponse.json({ error: "path 必填" }, { status: 400 });

  const { available, vaultPath } = getVaultConfig();
  if (!available)
    return NextResponse.json({ error: "vault 不可用" }, { status: 503 });

  const ext = path.extname(raw).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType)
    return NextResponse.json({ error: "不支持的资源类型" }, { status: 415 });

  const normalized = path.normalize(raw).replace(/^[/\\]+/, "");
  if (normalized.split(path.sep).some((part) => part.startsWith("."))) {
    return NextResponse.json({ error: "非法路径" }, { status: 400 });
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
    const found = await findVaultAssetByName(vaultPath, path.basename(normalized));
    if (!found)
      return NextResponse.json({ error: "资源不存在" }, { status: 404 });
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
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    // SVG 可内嵌脚本：直接打开时用 CSP + sandbox 禁止执行
    if (ext === ".svg") {
      headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    }
    return new NextResponse(new Uint8Array(data), { headers });
  } catch (error) {
    console.error("[obsidian/asset] 读取失败:", error);
    return NextResponse.json({ error: "资源读取失败" }, { status: 500 });
  }
}
