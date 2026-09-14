import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chatOnce, type ChatTurn } from "@/lib/ai";
import { generateBrainstormTitle } from "@/lib/brainstorm-title";
import {
  ensureDefaultKnowledgeSpace,
  searchKnowledgeChunks,
  parseKnowledgeScope,
  type KnowledgeCitation,
} from "@/lib/knowledge-grounding";
import { syncObsidianFile } from "@/lib/obsidian-sync";
import { resolveWorkbenchVaultPath } from "@/lib/vault-folders";
import { extractUrlMap, matchQueryToUrls, fetchExternalUrl } from "@/lib/fetch-external-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StoredCitation = KnowledgeCitation & { messageIndex: number };

function asMessages(value: unknown): ChatTurn[] {
  return Array.isArray(value) ? (value as ChatTurn[]) : [];
}

function asCitations(value: unknown): StoredCitation[] {
  return Array.isArray(value) ? (value as StoredCitation[]) : [];
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|#^\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 72);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    action?: "message" | "save-note" | "proposition" | "to-reasoning";
    content?: string;
    assistantContent?: string;
  };
  const session = await prisma.brainstormSession.findUnique({
    where: { id },
    include: { knowledgeSpace: true },
  });
  if (!session || session.mode !== "knowledge") {
    return NextResponse.json({ error: "知识库会话不存在" }, { status: 404 });
  }

  if (body.action === "save-note") {
    const answer = body.assistantContent?.trim();
    if (!answer) return NextResponse.json({ error: "没有可保存的回答" }, { status: 400 });
    const date = new Date().toISOString().slice(0, 10);
    const title = safeFileName(session.question) || "知识库问答";
    const relativePath = `DawnKB/知识库问答/${date}-${title}.md`;
    const resolved = resolveWorkbenchVaultPath(relativePath);
    fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
    const citations = asCitations(session.citations)
      .slice(-12)
      .map((item) => `- [[${item.path.replace(/\.md$/i, "")}]]：${item.quote.slice(0, 120).replace(/\s+/g, " ")}`)
      .join("\n");
    fs.writeFileSync(
      resolved.absolutePath,
      `---\ntitle: "${title.replaceAll('"', '\\"')}"\ntags: [DawnKB, 知识库问答]\ncreated: ${date}\n---\n\n# ${session.question}\n\n${answer}\n\n## 来源\n\n${citations || "- 本次回答没有引用来源"}\n`,
      "utf8",
    );
    await syncObsidianFile(resolved.absolutePath);
    await prisma.brainstormSession.update({
      where: { id },
      data: {
        increments: { increment: 1 },
        incrementLog: [
          ...((Array.isArray(session.incrementLog) ? session.incrementLog : []) as object[]),
          { title, path: resolved.relativePath, at: new Date().toISOString() },
        ] as never,
      },
    });
    return NextResponse.json({ path: resolved.relativePath, title });
  }

  if (body.action === "proposition") {
    const content = body.content?.trim();
    if (!content) return NextResponse.json({ error: "命题不能为空" }, { status: 400 });
    const propositions = Array.isArray(session.propositions) ? (session.propositions as object[]) : [];
    const next = [
      ...propositions,
      { id: `P-${String(propositions.length + 1).padStart(2, "0")}`, text: content, status: "pending" },
    ].slice(-12);
    await prisma.brainstormSession.update({ where: { id }, data: { propositions: next as never } });
    return NextResponse.json({ propositions: next });
  }

  if (body.action === "to-reasoning") {
    const evidence = body.assistantContent?.trim() || body.content?.trim();
    const created = await prisma.brainstormSession.create({
      data: {
        question: session.question,
        mode: "reasoning",
        references: session.references as never,
        messages: evidence
          ? [
              { role: "user", content: `请基于以下知识库证据继续推演：\n\n${evidence}` },
            ]
          : [],
      },
    });
    return NextResponse.json({ id: created.id });
  }

  const content = body.content?.trim();
  if (!content) return NextResponse.json({ error: "问题不能为空" }, { status: 400 });
  const space = session.knowledgeSpace ?? (await ensureDefaultKnowledgeSpace());
  const citations = await searchKnowledgeChunks(
    `${session.question} ${content}`.slice(0, 500),
    space.scope,
    8,
  );
  const scope = parseKnowledgeScope(space.scope);

  // 从引用文档及知识空间中提取外部 API 地址，动态抓取内容
  let externalBlock = "";
  const citedIds = [...new Set(citations.map((c) => c.articleId))];
  // 搜索所有含 URL 的文档，并始终包含 API 文档索引页
  const queryLower = `${session.question} ${content}`.toLowerCase();
  const keywords = queryLower.split(/[\s？?，,。]+/).filter((w) => w.length > 1);
  const urlArticles = await prisma.article.findMany({
    where: {
      content: { contains: "https://" },
      ...(scope.type === "selection"
        ? { id: { in: scope.articleIds } }
        : { url: { startsWith: "obsidian://" } }),
    },
    select: { id: true, title: true, content: true },
    take: 200,
  });
  // 优先取匹配查询关键词的文档 + 始终包含 API 文档索引页
  const relevantUrlArticles = urlArticles.filter((a) => {
    const t = (a.title + a.content).toLowerCase();
    return keywords.some((kw) => t.includes(kw));
  });
  // 确保 API 文档索引页始终被包含
  const apiDocArticles = urlArticles.filter((a) =>
    /api[^a-z]*(文档|对接|doc|index|reference)/i.test(a.title),
  );
  const allArticleIds = new Set([
    ...citedIds,
    ...relevantUrlArticles.slice(0, 10).map((a) => a.id),
    ...apiDocArticles.map((a) => a.id),
  ]);
  const articles = await prisma.article.findMany({
    where: { id: { in: [...allArticleIds] } },
    select: { id: true, content: true },
  });
  const allContent = articles.map((a) => a.content ?? "").join("\n");
  const urlMap = extractUrlMap(allContent);
  const matchedUrls = matchQueryToUrls(`${session.question} ${content}`, urlMap);
  if (matchedUrls.length > 0) {
    const fetchResults = await Promise.all(
      matchedUrls.map(async ([label, url]) => {
        const result = await fetchExternalUrl(url);
        return { label, ...result };
      }),
    );
    const fetched = fetchResults.filter((r) => r.content);
    if (fetched.length > 0) {
      externalBlock = fetched
        .map(
          (r) =>
            `[外部文档] ${r.label}\n来源：${r.url}\n${r.content!.slice(0, 6000)}`,
        )
        .join("\n\n---\n\n");
    }
  }

  const history = [...asMessages(session.messages), { role: "user" as const, content }];
  const titlePromise = session.title
    ? Promise.resolve(session.title)
    : generateBrainstormTitle({ question: session.question, messages: history });
  const messageIndex = history.length;
  const stored = citations.map((citation) => ({ ...citation, messageIndex }));

  let answer: string;
  if (citations.length === 0 && session.groundingPolicy === "strict") {
    answer = "当前选择的知识来源中没有找到足够证据回答这个问题。你可以换一种问法、扩大 Knowledge Space 范围，或切换到“来源 + 模型补充”模式。";
  } else {
    const sourceBlock = citations
      .map(
        (item) =>
          `[${item.id}] 《${item.title}》｜${item.path || "DawnKB"}｜字符 ${item.startOffset}-${item.endOffset}\n${item.quote}`,
      )
      .join("\n\n");
    const assisted = session.groundingPolicy === "assisted";
    const sysPrompt = [
      "你是 DawnKB 的知识库研究助手。用中文回答，先给结论，再给关键依据。",
      "每个可验证事实后必须使用 [S1] 这类来源编号；不得编造不存在的来源编号。",
      "只能把下方来源片段当作知识库事实。来源不足时明确说'知识库中没有足够证据'。",
      assisted
        ? "当前是来源 + 模型补充模式。必须分成'基于知识库'与'模型补充'两节；模型补充不得伪装成来源事实。"
        : "当前是严格来源模式。不得使用来源片段以外的事实。",
      `来源片段：\n${sourceBlock || "（没有命中来源）"}`,
      externalBlock
        ? `外部文档（动态抓取，可引为补充依据，但优先使用本地来源）：\n${externalBlock}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    answer = await chatOnce({
      system: sysPrompt,
      messages: history.slice(-8),
      maxTokens: 1800,
    });
    answer = answer.trim() || "知识库中没有足够证据。";
  }

  const nextMessages = [...history, { role: "assistant" as const, content: answer }];
  const nextCitations = [...asCitations(session.citations), ...stored].slice(-80);
  const title = await titlePromise;
  await prisma.brainstormSession.update({
    where: { id },
    data: {
      messages: nextMessages as never,
      citations: nextCitations as never,
      title,
      status: "active",
    },
  });
  return NextResponse.json({ answer, citations: stored, groundingPolicy: session.groundingPolicy, title });
}
