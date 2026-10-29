import { NextRequest, NextResponse } from "next/server";
import {
  ATTACH_MAX_COUNT,
  saveAttachedImages,
  type AttachedImage,
} from "@/lib/cloud/import-assets";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";

export const runtime = "nodejs";

type Body = { images?: unknown };

const MAX_BODY_BYTES = 20 * 1024 * 1024;

/** 对话导入的图片附件：落盘到 vault 导入收件箱 assets 目录，返回 ![[文件名]] 引用 */
export async function POST(req: NextRequest) {
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "图片过大，单张不超过 4MB、每轮最多 4 张" }, { status: 413 });
  }
  const body = await readJsonObject<Body>(req);
  if (!body) return invalidJsonResponse();
  if (!Array.isArray(body.images) || body.images.length === 0) {
    return NextResponse.json({ error: "请提供要附加的图片" }, { status: 400 });
  }
  if (body.images.length > ATTACH_MAX_COUNT) {
    return NextResponse.json({ error: `每轮最多附加 ${ATTACH_MAX_COUNT} 张图片` }, { status: 400 });
  }
  if (!body.images.every((item): item is string => typeof item === "string")) {
    return invalidJsonResponse();
  }
  try {
    const saved: AttachedImage[] = saveAttachedImages(body.images);
    return NextResponse.json({ images: saved }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "图片保存失败" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
