import { fetchImportLink } from "@/lib/cloud/link-import";
import { NextRequest, NextResponse } from "next/server";
import { cloudImportEnabled, importCloudDocument, queueCloudImport, refreshImportedDocument, updateMarkdownIndexes } from "@/lib/cloud/knowledge-import";
import { IMPORT_MAX_BYTES } from "@/lib/cloud/import-plan";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json({ enabled: cloudImportEnabled(), configured: Boolean(process.env.DEEPSEEK_API_KEY), provider: "DeepSeek", maxBytes: IMPORT_MAX_BYTES }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!cloudImportEnabled()) return NextResponse.json({ error: "云端导入尚未启用" }, { status: 403 });
  const length = Number(request.headers.get("content-length") || 0);
  const maxBody = IMPORT_MAX_BYTES * 6 + 32_768;
  if (length > maxBody) return NextResponse.json({ error: "文档不能超过 1MB" }, { status: 413 });
  try {
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "请提供文档内容" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxBody) {
        await reader.cancel();
        return NextResponse.json({ error: "文档不能超过 1MB" }, { status: 413 });
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object") return NextResponse.json({ error: "文档请求格式无效" }, { status: 400 });
    if (typeof body.reindexPath === "string") {
      const result = await queueCloudImport(async () => { const indexed = await refreshImportedDocument(body.reindexPath); const markdownIndexes = await updateMarkdownIndexes(body.reindexPath, indexed.title); return { ...indexed, markdownIndexes }; });
      return NextResponse.json({ ...result, indexed: true, relativePath: body.reindexPath, status: "indexed", reason: "索引已更新" });
    }
    if (typeof body.url === "string") {
      const result = await queueCloudImport(async () => {
        const page = await fetchImportLink(body.url);
        return importCloudDocument(page.content, "", typeof body.title === "string" ? body.title : "", { sourceTitle: page.title });
      });
      return NextResponse.json(result, { status: result.indexed ? 200 : 202, headers: { "Cache-Control": "no-store" } });
    }
    if (typeof body.content !== "string") return NextResponse.json({ error: "请提供文档正文" }, { status: 400 });
    const name = typeof body.filename === "string" ? body.filename : "";
    if (name && !/\.(md|txt)$/i.test(name)) return NextResponse.json({ error: "目前支持 .md 和 .txt 文件" }, { status: 400 });
    const result = await queueCloudImport(() => importCloudDocument(body.content, name, typeof body.title === "string" ? body.title : ""));
    return NextResponse.json(result, { status: result.indexed ? 200 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? "文档请求格式无效" : error instanceof Error ? error.message : "导入失败，请重试" }, { status: 400 });
  }
}
