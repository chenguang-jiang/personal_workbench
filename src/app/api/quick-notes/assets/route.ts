import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getWorkbenchRoot } from "@/lib/vault-folders";

const MAX_SIZE = 8 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** POST multipart：把粘贴/选择的图片写入 vault 的 JCG/附件/随手记 目录 */
export async function POST(req: NextRequest) {
  const root = getWorkbenchRoot();
  if (!root) return NextResponse.json({ error: "未配置 Obsidian vault" }, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "需要 multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });

  const ext = MIME_EXT[file.type];
  if (!ext) return NextResponse.json({ error: "仅支持 PNG / JPG / GIF / WebP" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "图片不能超过 8MB" }, { status: 400 });

  const dir = path.join(root, "附件", "随手记");
  fs.mkdirSync(dir, { recursive: true });
  const name = `qn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

  const rel = path.join("JCG", "附件", "随手记", name);
  return NextResponse.json({
    path: rel,
    url: `/api/obsidian/asset?path=${encodeURIComponent(rel)}`,
  });
}
