import { NextRequest, NextResponse } from "next/server";
import { aiSupportsVision } from "@/lib/ai";
import {
  aiImportChatStream,
  aiImportGenerate,
  fetchAiImportSource,
  type AiImportMessage,
} from "@/lib/ai-import";
import { ATTACH_MAX_COUNT, isAttachedImageName } from "@/lib/cloud/import-assets";
import {
  importArchiveEnabled,
  importCloudDocument,
  queueCloudImport,
} from "@/lib/cloud/knowledge-import";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json(
    {
      archiveEnabled: importArchiveEnabled(),
      configured: Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY),
      // 当前后端能否看图：不能时前端提示图片只随文章保存、不参与讨论
      vision: await aiSupportsVision(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

type Body = {
  action?: unknown;
  url?: unknown;
  title?: unknown;
  messages?: unknown;
  draft?: unknown;
};

const MESSAGE_MAX = 40;
const CONTENT_MAX = 20_000;
/** 客户端回传的网页正文上限（抓取时已截断，这里只做校验兜底） */
const SOURCE_MAX = 100_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** 客户端回传的对话历史：逐条校验，source 只接受字符串字段 */
function asMessages(value: unknown): AiImportMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MESSAGE_MAX) return null;
  const out: AiImportMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (record.role !== "user" && record.role !== "assistant") return null;
    if (typeof record.content !== "string" || record.content.length > CONTENT_MAX) return null;
    const message: AiImportMessage = { role: record.role, content: record.content };
    // 图片只接受附件接口返回的文件名（形状校验在 isAttachedImageName 内）
    if (record.images !== undefined) {
      if (
        !Array.isArray(record.images) ||
        record.images.length > ATTACH_MAX_COUNT ||
        !record.images.every((item): item is string => typeof item === "string" && isAttachedImageName(item))
      ) {
        return null;
      }
      if (record.images.length > 0) message.images = record.images;
    }
    // 文档附件只接受包含 name 和 content 的文本对象
    if (record.documents !== undefined) {
      if (!Array.isArray(record.documents) || record.documents.length > 10) return null;
      const docs: Array<{ name: string; content: string }> = [];
      for (const doc of record.documents) {
        if (!doc || typeof doc !== "object") return null;
        const d = doc as Record<string, unknown>;
        if (typeof d.name !== "string" || typeof d.content !== "string") return null;
        if (d.name.length > 255 || d.content.length > 100_000) return null;
        docs.push({ name: d.name, content: d.content });
      }
      if (docs.length > 0) message.documents = docs;
    }
    if (record.source && typeof record.source === "object") {
      const source = record.source as Record<string, unknown>;
      if (
        typeof source.url === "string" &&
        typeof source.content === "string" &&
        source.content.length <= SOURCE_MAX
      ) {
        message.source = {
          url: source.url,
          title: typeof source.title === "string" ? source.title : "",
          content: source.content,
        };
      }
    }
    out.push(message);
  }
  return out;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof SyntaxError) return "AI 返回格式异常，请重试";
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function POST(req: NextRequest) {
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "对话内容过大，请开启新对话" }, { status: 413 });
  }
  const body = await readJsonObject<Body>(req);
  if (!body) return invalidJsonResponse();
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "fetch") {
      if (typeof body.url !== "string" || !body.url.trim()) {
        return NextResponse.json({ error: "请提供网页链接" }, { status: 400 });
      }
      const source = await fetchAiImportSource(body.url.trim());
      return NextResponse.json({ source }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "message") {
      const messages = asMessages(body.messages);
      if (!messages) return NextResponse.json({ error: "对话内容格式无效" }, { status: 400 });
      const stream = await aiImportChatStream(messages);
      return new Response(stream, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (action === "generate") {
      const messages = asMessages(body.messages);
      if (!messages) return NextResponse.json({ error: "对话内容格式无效" }, { status: 400 });
      const draft = await aiImportGenerate(messages, typeof body.title === "string" ? body.title : "");
      return NextResponse.json({ draft }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "archive") {
      if (!importArchiveEnabled()) {
        return NextResponse.json({ error: "归档服务尚未启用" }, { status: 403 });
      }
      const draft = body.draft as Record<string, unknown> | undefined;
      const title = draft && typeof draft.title === "string" ? draft.title.trim() : "";
      const content = draft && typeof draft.content === "string" ? draft.content : "";
      if (!title || !content.trim()) {
        return NextResponse.json({ error: "缺少文章标题或正文" }, { status: 400 });
      }
      const result = await queueCloudImport(() => importCloudDocument(content, "", title));
      return NextResponse.json(result, {
        status: result.indexed ? 200 : 202,
        headers: { "Cache-Control": "no-store" },
      });
    }

    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "AI 导入失败，请重试") },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
