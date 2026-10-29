import { NextRequest, NextResponse } from "next/server";
import { cloudImportEnabled, editCloudDocument, queueCloudImport } from "@/lib/cloud/knowledge-import";
import { IMPORT_MAX_BYTES } from "@/lib/cloud/import-plan";

export async function POST(request: NextRequest) {
  if (!cloudImportEnabled()) return NextResponse.json({ error: "云端编辑未启用" }, { status: 403 });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("正文不能为空");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > IMPORT_MAX_BYTES * 6 + 32768) { await reader.cancel(); return NextResponse.json({ error: "正文不能超过 1MB" }, { status: 413 }); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body.articleId !== "string" || typeof body.content !== "string" || !Number.isInteger(body.contentVersion)) throw new Error("编辑请求无效，请刷新重试");
    const article = await queueCloudImport(() => editCloudDocument(body.articleId, body.content, body.contentVersion));
    return NextResponse.json(article, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    return NextResponse.json({ error: message }, { status: message.includes("发生变化") ? 409 : 400 });
  }
}
