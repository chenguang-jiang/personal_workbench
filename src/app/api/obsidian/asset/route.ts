import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getVaultConfig } from "@/lib/obsidian-sync";

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

/** `![[name.png]]` 不带目录时，按文件名在 vault 内查找。 */
function findByName(root: string, name: string): string | null {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name === name) {
        return full;
      }
    }
  }
  return null;
}

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
    const found = findByName(vaultPath, path.basename(normalized));
    if (!found)
      return NextResponse.json({ error: "资源不存在" }, { status: 404 });
    filePath = found;
  }

  const data = fs.readFileSync(/* turbopackIgnore: true */ filePath);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
