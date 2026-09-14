import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { brainstormStream, chatOnce, type ChatTurn } from "@/lib/ai";
import { generateBrainstormTitle } from "@/lib/brainstorm-title";
import { searchKnowledge } from "@/lib/knowledge-search";
import { syncObsidianFile } from "@/lib/obsidian-sync";
import { resolveVaultPath } from "@/lib/obsidian-vault";

export const dynamic = "force-dynamic";

export type Reference = {
  id: string;
  type: "article" | "folder";
  title: string;
  articleId?: string;
  path?: string;
};

export type RouteStatus = "open" | "exploring" | "completed" | "supported-with-gaps";
export type Route = { id: string; text: string; status: RouteStatus };
export type PropStatus = "pending" | "user-confirmed" | "revised";
export type Proposition = {
  id: string;
  text: string;
  status: PropStatus;
  boundary?: string;
  decision?: string;
};

type SessionMessages = ChatTurn[];

const ROUTE_STATUSES: RouteStatus[] = ["open", "exploring", "completed", "supported-with-gaps"];
const PROP_STATUSES: PropStatus[] = ["pending", "user-confirmed", "revised"];

function asMessages(value: unknown): SessionMessages {
  return Array.isArray(value) ? (value as SessionMessages) : [];
}

function asRefs(value: unknown): Reference[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      id: String(item.id ?? ""),
      type: item.type === "folder" ? ("folder" as const) : ("article" as const),
      title: String(item.title ?? ""),
      articleId: item.articleId ? String(item.articleId) : undefined,
      path: item.path ? String(item.path) : undefined,
    }))
    .filter((item) => item.id && item.title);
}

function asRoutes(value: unknown): Route[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item, index) => ({
      id: String(item.id ?? `R-${String(index + 1).padStart(2, "0")}`),
      text: String(item.text ?? ""),
      status: (ROUTE_STATUSES as string[]).includes(String(item.status))
        ? (String(item.status) as RouteStatus)
        : "open",
    }))
    .filter((item) => item.text);
}

function asProps(value: unknown): Proposition[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item, index) => ({
      id: String(item.id ?? `P-${String(index + 1).padStart(2, "0")}`),
      text: String(item.text ?? ""),
      status: (PROP_STATUSES as string[]).includes(String(item.status))
        ? (String(item.status) as PropStatus)
        : "pending",
      boundary: item.boundary ? String(item.boundary) : undefined,
      decision: item.decision ? String(item.decision) : undefined,
    }))
    .filter((item) => item.text);
}

function nextId(prefix: string, existing: { id: string }[]): string {
  let max = 0;
  for (const item of existing) {
    const match = item.id.match(/(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(2, "0")}`;
}

// GET /api/brainstorm/[id] — 会话详情
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await prisma.brainstormSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json({
    id: session.id,
    question: session.question,
    title: session.title,
    mode: session.mode,
    knowledgeSpaceId: session.knowledgeSpaceId,
    groundingPolicy: session.groundingPolicy,
    citations: Array.isArray(session.citations) ? session.citations : [],
    status: session.status,
    propositions: asProps(session.propositions),
    routes: asRoutes(session.routes),
    references: asRefs(session.references),
    summary: session.summary,
    increments: session.increments,
    incrementLog: asIncrementLog(session.incrementLog),
    decisions: asDecisions(session.decisions),
    messages: asMessages(session.messages),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
}

// DELETE /api/brainstorm/[id]
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.brainstormSession.deleteMany({ where: { id } });
  return NextResponse.json({ success: true });
}

// POST /api/brainstorm/[id] — 动作分发
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await prisma.brainstormSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: "会话不存在" }, { status: 404 });

  const body = (await req.json()) as {
    action?: string;
    content?: string;
    folder?: string;
    routeId?: string;
    refId?: string;
    status?: string;
    propId?: string;
    field?: "boundary" | "decision";
    groundingPolicy?: "strict" | "assisted";
    decision?: DecisionInput;
  };

  switch (body.action) {
    case "grounding-policy": {
      if (session.mode !== "knowledge") {
        return NextResponse.json({ error: "仅知识库模式支持来源策略" }, { status: 409 });
      }
      const groundingPolicy = body.groundingPolicy === "assisted" ? "assisted" : "strict";
      await prisma.brainstormSession.update({ where: { id }, data: { groundingPolicy } });
      return NextResponse.json({ groundingPolicy });
    }

    case "message":
      return streamMessage(session, (body.content ?? "").trim(), body.decision as DecisionInput | undefined);

    case "ref-add": {
      const ref = (body as { ref?: Reference }).ref;
      if (!ref || !ref.title || (ref.type !== "article" && ref.type !== "folder")) {
        return NextResponse.json({ error: "参考无效" }, { status: 400 });
      }
      const refKey = ref.type === "article" ? `a:${ref.articleId}` : `f:${ref.path}`;
      const refs = asRefs(session.references);
      if (refs.some((item) => item.id === refKey)) return NextResponse.json({ references: refs });
      const next = [...refs, { id: refKey, type: ref.type, title: ref.title, articleId: ref.articleId, path: ref.path }].slice(0, 6);
      await prisma.brainstormSession.update({ where: { id }, data: { references: next as never } });
      return NextResponse.json({ references: next });
    }

    case "ref-remove": {
      const next = asRefs(session.references).filter((item) => item.id !== body.refId);
      await prisma.brainstormSession.update({ where: { id }, data: { references: next as never } });
      return NextResponse.json({ references: next });
    }

    case "revise-reference":
      return reviseReference(session, body.refId);

    case "generate-routes":
      return generateRoutes(session);

    case "route-add": {
      const text = (body.content ?? "").trim();
      if (!text) return NextResponse.json({ error: "路线不能为空" }, { status: 400 });
      const routes = asRoutes(session.routes);
      const next = [...routes, { id: nextId("R", routes), text, status: "open" as RouteStatus }].slice(0, 12);
      await prisma.brainstormSession.update({ where: { id }, data: { routes: next as never } });
      return NextResponse.json({ routes: next });
    }

    case "route-status": {
      const routes = asRoutes(session.routes);
      const status = (ROUTE_STATUSES as string[]).includes(body.status ?? "")
        ? (body.status as RouteStatus)
        : null;
      if (!status || !body.routeId) return NextResponse.json({ error: "参数无效" }, { status: 400 });
      const next = routes.map((route) => (route.id === body.routeId ? { ...route, status } : route));
      await prisma.brainstormSession.update({ where: { id }, data: { routes: next as never } });
      return NextResponse.json({ routes: next });
    }

    case "route-remove": {
      const next = asRoutes(session.routes).filter((route) => route.id !== body.routeId);
      await prisma.brainstormSession.update({ where: { id }, data: { routes: next as never } });
      return NextResponse.json({ routes: next });
    }

    case "proposition": {
      const text = (body.content ?? "").trim();
      if (!text) return NextResponse.json({ error: "命题不能为空" }, { status: 400 });
      const props = asProps(session.propositions);
      if (props.some((item) => item.text === text)) return NextResponse.json({ propositions: props });
      const next = [...props, { id: nextId("P", props), text, status: "pending" as PropStatus }].slice(0, 12);
      await prisma.brainstormSession.update({ where: { id }, data: { propositions: next as never } });
      return NextResponse.json({ propositions: next });
    }

    case "unproposition": {
      const next = asProps(session.propositions).filter((item) => item.id !== body.propId);
      await prisma.brainstormSession.update({ where: { id }, data: { propositions: next as never } });
      return NextResponse.json({ propositions: next });
    }

    case "proposition-status": {
      const status = (PROP_STATUSES as string[]).includes(body.status ?? "")
        ? (body.status as PropStatus)
        : null;
      if (!status || !body.propId) return NextResponse.json({ error: "参数无效" }, { status: 400 });
      const today = new Date().toISOString().slice(0, 10);
      const next = asProps(session.propositions).map((item) => {
        if (item.id !== body.propId) return item;
        const updated: Proposition = { ...item, status };
        if (status === "user-confirmed" && !item.decision) {
          updated.decision = `${today} 用户明确“接受”：${item.text.slice(0, 60)}`;
        }
        if (status === "revised" && !item.decision) {
          updated.decision = "待确认。";
        }
        return updated;
      });
      await prisma.brainstormSession.update({ where: { id }, data: { propositions: next as never } });
      return NextResponse.json({ propositions: next });
    }

    case "proposition-note": {
      const content = (body.content ?? "").trim();
      if (!body.propId || !body.field || !content) {
        return NextResponse.json({ error: "参数无效" }, { status: 400 });
      }
      const next = asProps(session.propositions).map((item) =>
        item.id === body.propId ? { ...item, [body.field as string]: content } : item,
      );
      await prisma.brainstormSession.update({ where: { id }, data: { propositions: next as never } });
      return NextResponse.json({ propositions: next });
    }

    case "proposition-boundary-ai": {
      const props = asProps(session.propositions);
      const target = props.find((item) => item.id === body.propId);
      if (!target) return NextResponse.json({ error: "命题不存在" }, { status: 404 });
      try {
        const text = await chatOnce({
          system: "你是严谨的研究助手。只输出 1-2 句中文，不要标题、不要列表。",
          messages: [
            {
              role: "user",
              content: `为以下命题写一条“边界”说明：指出它的适用范围、成立前提与反例风险，语气克制，不超过 90 字。\n命题：${target.text}\n会话问题：${session.question}`,
            },
          ],
          maxTokens: 300,
        });
        const boundary = text.replace(/\s+/g, " ").trim().slice(0, 200);
        if (!boundary) throw new Error("AI 未返回内容");
        const next = props.map((item) => (item.id === target.id ? { ...item, boundary } : item));
        await prisma.brainstormSession.update({ where: { id }, data: { propositions: next as never } });
        return NextResponse.json({ propositions: next });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "AI 边界分析失败" },
          { status: 503 },
        );
      }
    }

    case "increment":
      return writeIncrement(session, body.folder);

    case "integrate-reference":
      return integrateReference(session, body.refId);

    case "done": {
      let summary = "";
      try {
        const turns = asMessages(session.messages)
          .slice(-6)
          .map((turn) => `${turn.role === "user" ? "用户" : "AI"}：${turn.content.slice(0, 300)}`)
          .join("\n");
        summary = (
          await chatOnce({
            system: "你是会话记录员。只输出 1-2 句中文总结，不要标题。",
            messages: [
              {
                role: "user",
                content: `用 1-2 句话总结这次头脑风暴：已确认什么、哪些还需继续研究。\n问题：${session.question}\n近期讨论：\n${turns}`,
              },
            ],
            maxTokens: 200,
          })
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
      } catch {
        summary = "";
      }
      if (!summary) {
        const last = [...asMessages(session.messages)].reverse().find((turn) => turn.role === "assistant");
        summary = last ? `本次 Brainstorm 已结束；${last.content.replace(/[#*`>\n]/g, " ").trim().slice(0, 60)}…` : "本次 Brainstorm 已结束。";
      }
      await prisma.brainstormSession.update({ where: { id }, data: { status: "done", summary } });
      return NextResponse.json({ status: "done", summary });
    }

    default:
      return NextResponse.json({ error: "未知动作" }, { status: 400 });
  }
}

/** 流式推演：先检索知识库相关条目注入 system，再把 AI 回复落库 */
type DecisionInput = { choice?: unknown; label?: unknown; q?: unknown };
export type DecisionEntry = { id: string; choice: string; label: string; q: string; at: string };

function asDecisions(value: unknown): DecisionEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is DecisionEntry =>
      !!item && typeof item === "object" && typeof (item as DecisionEntry).choice === "string",
  );
}

async function streamMessage(
  session: {
    id: string;
    question: string;
    title?: string | null;
    messages: unknown;
    references: unknown;
    decisions?: unknown;
  },
  content: string,
  decision?: DecisionInput,
) {
  if (!content) return NextResponse.json({ error: "内容不能为空" }, { status: 400 });
  // 结构化记录用户对 AI 选项/提问的选择，写回时按此归档整理
  if (decision && typeof decision.choice === "string" && decision.choice.trim()) {
    const entry: DecisionEntry = {
      id: nextId("D", asDecisions(session.decisions)),
      choice: decision.choice.trim().slice(0, 60),
      label: String(decision.label ?? "").slice(0, 160),
      q: String(decision.q ?? "").slice(0, 160),
      at: new Date().toISOString(),
    };
    await prisma.brainstormSession.update({
      where: { id: session.id },
      data: { decisions: [...asDecisions(session.decisions), entry] as never },
    });
  }
  const history: SessionMessages = [...asMessages(session.messages), { role: "user", content }];
  const titlePromise = session.title
    ? Promise.resolve(session.title)
    : generateBrainstormTitle({ question: session.question, messages: history });

  let knowledge = "";
  try {
    const hits = await searchKnowledge(`${session.question} ${content}`.slice(0, 120), 5);
    knowledge = hits
      .map((hit) => `《${hit.title}》${hit.folder ? `（${hit.folder}）` : ""}`)
      .join("\n");
  } catch {
    knowledge = "";
  }

  const references = await buildReferenceContext(asRefs(session.references));

  let upstream: ReadableStream<Uint8Array>;
  try {
    upstream = await brainstormStream({ question: session.question, knowledge, references, history });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 后端不可用" },
      { status: 503 },
    );
  }

  // tee：一路流给客户端，另一路后台独立消费并落库——客户端中途断开也不丢回复
  const [clientStream, persistStream] = upstream.tee();
  const decoder = new TextDecoder();
  void (async () => {
    const reader = persistStream.getReader();
    let accumulated = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
      }
    } catch {
      return;
    }
    if (accumulated.trim()) {
      const title = await titlePromise;
      await prisma.brainstormSession
        .update({
          where: { id: session.id },
          data: {
            messages: [...history, { role: "assistant", content: accumulated }] as never,
            title,
            status: "active",
          },
        })
        .catch(() => {});
    }
  })();

  return new Response(clientStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** 挂载参考 → 注入推演上下文（文章全文节选 / 文件夹文章节选） */
async function buildReferenceContext(refs: Reference[]): Promise<string> {
  const blocks: string[] = [];
  for (const ref of refs.slice(0, 4)) {
    try {
      if (ref.type === "article" && ref.articleId) {
        const article = await prisma.article.findUnique({ where: { id: ref.articleId } });
        if (article?.content) {
          blocks.push(`【文章】《${article.title}》正文（可能截断）：\n${article.content.slice(0, 6000)}`);
        }
      } else if (ref.type === "folder" && ref.path) {
        const articles = await prisma.article.findMany({
          where: { url: { startsWith: `obsidian://${ref.path}/` } },
          orderBy: { updatedAt: "desc" },
          take: 6,
          select: { title: true, content: true },
        });
        if (articles.length > 0) {
          blocks.push(
            `【文件夹】「${ref.title}」内文章节选：\n${articles
              .map((item) => `《${item.title}》：${(item.content ?? "").slice(0, 700)}`)
              .join("\n\n")}`,
          );
        }
      }
    } catch {
      // 单个参考加载失败不影响整体
    }
  }
  return blocks.join("\n\n");
}

/** AI 修订挂载的文章：结合讨论输出修订后的完整 Markdown 正文（前端确认后才写回） */
async function reviseReference(
  session: { id: string; question: string; messages: unknown; references: unknown },
  refId?: string,
) {
  const ref = asRefs(session.references).find((item) => item.id === refId);
  if (!ref || ref.type !== "article" || !ref.articleId) {
    return NextResponse.json({ error: "该参考不是文章" }, { status: 404 });
  }
  const article = await prisma.article.findUnique({ where: { id: ref.articleId } });
  if (!article?.content?.trim()) {
    return NextResponse.json({ error: "文章没有可修订的内容" }, { status: 404 });
  }
  const turns = asMessages(session.messages)
    .slice(-6)
    .map((turn) => `${turn.role === "user" ? "用户" : "AI"}：${turn.content.slice(0, 400)}`)
    .join("\n");
  try {
    const proposed = await chatOnce({
      system:
        "你是严谨的编辑。只输出修订后的完整 Markdown 正文：不要 frontmatter、不要解释、不要代码块包裹。保留原文结构与事实，只融入讨论中确认的修改。",
      messages: [
        {
          role: "user",
          content: `请结合头脑风暴的讨论修订下面这篇文章。\n文章标题：${article.title}\n头脑风暴问题：${session.question}\n讨论：\n${turns || "（无讨论，仅做结构与表述优化）"}\n原文：\n${article.content.slice(0, 9000)}`,
        },
      ],
      maxTokens: 6000,
    });
    const clean = proposed.trim();
    if (!clean) throw new Error("AI 未返回修订内容");
    return NextResponse.json({ proposed: clean, articleId: article.id, title: article.title });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 修订失败" },
      { status: 503 },
    );
  }
}

/** AI 规划探索路线：严格 JSON 数组解析 */
async function generateRoutes(session: { id: string; question: string; messages: unknown; routes: unknown }) {
  const turns = asMessages(session.messages)
    .slice(-4)
    .map((turn) => `${turn.role === "user" ? "用户" : "AI"}：${turn.content.slice(0, 400)}`)
    .join("\n");
  try {
    const text = await chatOnce({
      system: "你是探索路线规划师。只输出 JSON 数组，不要输出其他内容。",
      messages: [
        {
          role: "user",
          content: `基于下面的头脑风暴问题与讨论，提出 3 条“探索路线”——可验证的子问题或推演线路，每条 20-60 字的问句。\n只输出 JSON 数组，如 ["...", "...", "..."]。\n问题：${session.question}\n讨论：\n${turns || "（刚开始，围绕问题本身规划）"}`,
        },
      ],
      maxTokens: 500,
    });
    const matched = text.match(/\[[\s\S]*\]/);
    const parsed = matched ? (JSON.parse(matched[0]) as unknown) : [];
    const texts = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6)
      : [];
    if (texts.length === 0) throw new Error("AI 未返回有效路线");
    const existing = asRoutes(session.routes);
    const merged = [...existing];
    for (const item of texts) {
      if (!merged.some((route) => route.text === item)) {
        merged.push({ id: nextId("R", merged), text: item, status: "open" });
      }
    }
    const next = merged.slice(0, 12);
    await prisma.brainstormSession.update({ where: { id: session.id }, data: { routes: next as never } });
    return NextResponse.json({ routes: next });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "路线规划失败" },
      { status: 503 },
    );
  }
}

/** 知识增量：把本次推演写成 Obsidian 笔记 */
// 增量笔记正文：问题 + 探索路线 + 命题台账 + 推演记录
function buildIncrementBody(session: {
  question: string;
  propositions: unknown;
  routes: unknown;
  messages: unknown;
  decisions?: unknown;
}): string {
  const props = asProps(session.propositions);
  const routes = asRoutes(session.routes);
  const lines: string[] = [`# ${session.question}`, ""];

  if (routes.length > 0) {
    lines.push("## 探索路线", "");
    routes.forEach((route) => lines.push(`- [${route.status === "completed" ? "x" : " "}] ${route.text}（${route.status}）`));
    lines.push("");
  }

  if (props.length > 0) {
    lines.push("## 命题台账", "");
    props.forEach((item) => {
      lines.push(`### ${item.id} ${item.text}`, "", `状态：${item.status}`);
      if (item.boundary) lines.push("", `边界：${item.boundary}`);
      if (item.decision) lines.push("", `你的决定：${item.decision}`);
      lines.push("");
    });
  }

  const decisions = asDecisions(session.decisions);
  if (decisions.length > 0) {
    lines.push("## 你的决定", "");
    decisions.forEach((item) =>
      lines.push(`- ${item.q ? `${item.q} → ` : ""}**${item.choice}**${item.label ? ` · ${item.label}` : ""}`),
    );
    lines.push("");
  }

  lines.push("## 推演记录", "");
  for (const turn of asMessages(session.messages).slice(-8)) {
    lines.push(
      turn.role === "user" ? `**我**：${turn.content.trim()}` : `**AI**：${turn.content.trim().slice(0, 1200)}`,
      "",
    );
  }
  return lines.join("\n").trim();
}

/** 写回同时整理原文：AI 结合原文与增量内容生成整合稿（提案制，用户确认后才应用） */
async function integrateReference(
  session: {
    id: string;
    question: string;
    propositions: unknown;
    routes: unknown;
    messages: unknown;
    references: unknown;
    decisions?: unknown;
  },
  refId?: string,
) {
  const ref = asRefs(session.references).find((item) => item.id === refId);
  if (!ref || ref.type !== "article" || !ref.articleId) {
    return NextResponse.json({ error: "该参考不是文章" }, { status: 404 });
  }
  const article = await prisma.article.findUnique({ where: { id: ref.articleId } });
  if (!article?.content?.trim()) {
    return NextResponse.json({ error: "文章没有可整理的内容" }, { status: 404 });
  }
  const increment = buildIncrementBody(session);
  const decisions = asDecisions(session.decisions);
  const decisionText = decisions
    .map((item) => `- ${item.q ? `${item.q} → ` : ""}${item.choice}${item.label ? ` · ${item.label}` : ""}`)
    .join("\n");
  try {
    const proposed = await chatOnce({
      system:
        "你是严谨的编辑。把「增量知识」整合进原文，只输出整合后的完整 Markdown 正文：不要 frontmatter、不要解释、不要代码块包裹。保留原文框架与事实，把增量内容写进最合适的章节（可新增小节或段落），去重合并相近表述，不虚构事实，代码块/mermaid/表格原样保留。「你的决定」是用户对方案取舍的明确表态：整合时以用户选择为准，未选方案只作对比简述或省略。",
      messages: [
        {
          role: "user",
          content: `文章标题：${article.title}\n\n增量知识（来自头脑风暴）：\n${increment.slice(0, 6000)}\n\n用户对方案/提问的选择（归档整理以此为准）：\n${decisionText || "（无记录）"}\n\n原文：\n${article.content.slice(0, 9000)}`,
        },
      ],
      maxTokens: 8000,
    });
    const clean = proposed.trim();
    if (!clean) throw new Error("AI 未返回整理内容");
    return NextResponse.json({ proposed: clean, articleId: article.id, title: article.title });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 整理失败" },
      { status: 503 },
    );
  }
}

type IncrementEntry = { title: string; path: string; at: string };

function asIncrementLog(value: unknown): IncrementEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is IncrementEntry =>
      !!item && typeof item === "object" && typeof (item as IncrementEntry).path === "string",
  );
}

async function writeIncrement(
  session: {
    id: string;
    question: string;
    propositions: unknown;
    routes: unknown;
    messages: unknown;
    incrementLog?: unknown;
  },
  folder?: string,
) {
  const target = resolveVaultPath(folder || "00-Inbox");
  if (!fs.existsSync(target.absolutePath) || !fs.statSync(target.absolutePath).isDirectory()) {
    return NextResponse.json({ error: "目标文件夹不存在" }, { status: 400 });
  }

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const fileName = `头脑风暴-${stamp}.md`;
  const filePath = path.join(target.absolutePath, fileName);

  const lines: string[] = [
    "---",
    `title: ${JSON.stringify(`头脑风暴·${session.question.slice(0, 40)}`)}`,
    `created: ${now.toISOString()}`,
    "source: DawnKB",
    "tags:",
    "  - DawnKB",
    "  - 头脑风暴",
    "---",
    "",
    buildIncrementBody(session),
  ];

  fs.writeFileSync(filePath, `${lines.join("\n").trim()}\n`, { encoding: "utf-8", flag: "wx" });
  await syncObsidianFile(filePath).catch(() => null);
  const relativePath = path.relative(target.vaultPath, filePath).split(path.sep).join("/");

  const log = [...asIncrementLog(session.incrementLog), { title: fileName, path: relativePath, at: now.toISOString() }];
  const incremented = await prisma.brainstormSession.update({
    where: { id: session.id },
    data: { increments: { increment: 1 }, incrementLog: log },
  });

  return NextResponse.json({ relativePath, increments: incremented.increments, log });
}
