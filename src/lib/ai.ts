import { generateText, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

/**
 * AI 后端（本地部署模式）
 *
 * 优先级：
 * 1. OpenAI API（若配置了 OPENAI_API_KEY）— 走云端，质量高
 * 2. 本地 Ollama（OLLAMA_HOST，默认 http://localhost:11434）— 走本地，零成本
 *    本地路径直连 Ollama 原生 /api/chat（带 think:false），
 *    因为 Ollama 的 OpenAI 兼容 /v1 接口不支持关闭思考，流式也更快可控。
 */
function ollamaConfig() {
  return {
    host: process.env.OLLAMA_HOST || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "qwen2.5:7b",
  };
}

function openAiConfig() {
  return {
    baseURL: process.env.OPENAI_BASE_URL?.replace(/\/+$/, "") || undefined,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  };
}

function getOpenAiModel() {
  const { baseURL, model } = openAiConfig();
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL });
  // 显式走 chat/completions 协议：SDK 默认可能命中 Responses API，
  // OpenAI 兼容代理（含本项目的 s2a 代理）不支持，会报 Invalid JSON response
  return openai.chat(model);
}

export interface AiStatus {
  provider: "openai" | "ollama" | "none";
  model: string;
  available: boolean;
  detail: string;
}

// 云端代理可达性探测（5 分钟缓存）：代理工具 fake-ip 环境下 TLS 可能失败，
// 失败时自动回退本地 Ollama，保证 AI 功能永远可用
let probeCache: { at: number; ok: boolean } | null = null;
async function openAiReachable(): Promise<boolean> {
  if (probeCache && Date.now() - probeCache.at < 5 * 60_000) return probeCache.ok;
  let ok = false;
  try {
    const { baseURL } = openAiConfig();
    const response = await fetch(`${baseURL ?? "https://api.openai.com/v1"}/models`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(4000),
    });
    ok = response.ok;
  } catch {
    ok = false;
  }
  probeCache = { at: Date.now(), ok };
  return ok;
}

/** 探测当前 AI 后端是否可用（OpenAI key 优先，其次本地 Ollama） */
export async function getAiStatus(): Promise<AiStatus> {
  if (process.env.OPENAI_API_KEY) {
    const { model } = openAiConfig();
    if (await openAiReachable()) {
      return { provider: "openai", model, available: true, detail: `云端 · ${model}` };
    }
  }
  const { host, model } = ollamaConfig();
  try {
    const response = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const data = (await response.json()) as { models?: { name: string }[] };
    const names = (data.models ?? []).map((item) => item.name);
    const hasModel = names.some((name) => name === model || name.startsWith(`${model}:`));
    if (hasModel) {
      return { provider: "ollama", model, available: true, detail: `本地 Ollama · ${model}` };
    }
    return {
      provider: "ollama",
      model,
      available: false,
      detail: `Ollama 已连接，但缺少模型。终端执行：ollama pull ${model}`,
    };
  } catch {
    return {
      provider: "none",
      model,
      available: false,
      detail: "本地 Ollama 未启动。终端执行：ollama serve（或配置 OPENAI_API_KEY）",
    };
  }
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

function wrapTextStream(textStream: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of textStream) controller.enqueue(encoder.encode(chunk));
      } finally {
        controller.close();
      }
    },
  });
}

/** 把 Ollama 原生 NDJSON 流转成纯文本字节流 */
function wrapOllamaStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            if (!line) continue;
            try {
              const parsed = JSON.parse(line) as {
                message?: { content?: string };
                error?: string;
              };
              if (parsed.error) throw new Error(parsed.error);
              const content = parsed.message?.content ?? "";
              if (content) controller.enqueue(encoder.encode(content));
            } catch (error) {
              if (error instanceof Error && error.message !== "Unexpected end of JSON input") {
                throw error;
              }
            }
          }
        }
      } catch (error) {
        controller.error(error);
        return;
      }
      controller.close();
    },
  });
}

/** 统一流式入口：OpenAI 走 ai-sdk，Ollama 走原生接口（think:false 关闭思考提速） */
async function runStream(options: {
  system: string;
  messages: ChatTurn[];
}): Promise<ReadableStream<Uint8Array>> {
  const { system, messages } = options;
  if (process.env.OPENAI_API_KEY && (await openAiReachable())) {
    const result = streamText({ model: getOpenAiModel(), system, messages });
    return wrapTextStream(result.textStream);
  }
  const { host, model } = ollamaConfig();
  // 注意：此版本 Ollama 会忽略顶层 system 参数，必须以 system 角色消息发送
  const upstream = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      think: false,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!upstream.ok || !upstream.body) {
    throw new Error(`Ollama 请求失败 (${upstream.status})`);
  }
  return wrapOllamaStream(upstream.body);
}

/** 非流式单次问答：用于路线规划、边界分析、会话总结等结构化小任务 */
export async function chatOnce(options: {
  system: string;
  messages: ChatTurn[];
  maxTokens?: number;
}): Promise<string> {
  const { system, messages, maxTokens = 700 } = options;
  if (process.env.OPENAI_API_KEY && (await openAiReachable())) {
    const result = await generateText({
      model: getOpenAiModel(),
      system,
      messages,
      maxOutputTokens: maxTokens,
    });
    return result.text;
  }
  const { host, model } = ollamaConfig();
  const response = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      think: false,
      stream: false,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!response.ok) throw new Error(`Ollama 请求失败 (${response.status})`);
  const data = (await response.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}

const READING_SYSTEM =
  "你是一个专业的阅读助手。请用中文简洁地回答，帮助用户理解内容。";

/** 针对选中文本或全文进行流式问答 */
export async function explainText(
  text: string,
  context?: string,
  question?: string,
  articleContent?: string,
) {
  const fullArticle = articleContent?.trim().substring(0, 8000);
  const prompt = [
    fullArticle ? `文章全文（可能被截断）：\n${fullArticle}` : "",
    context ? `选中位置的上下文：\n${context}` : "",
    `当前引用：\n${text}`,
    `用户的问题：\n${question || "请解释这段文本的含义、背景和相关概念。"}`,
    "请紧扣用户的问题回答；如果原文不足以得出结论，请明确说明，不要臆测。",
  ]
    .filter(Boolean)
    .join("\n\n");
  return runStream({ system: READING_SYSTEM, messages: [{ role: "user", content: prompt }] });
}

/** 流式翻译 */
export async function translateText(text: string, target: string = "中文") {
  return runStream({
    system: "你是一个专业翻译。请将用户提供的文本翻译成中文，保持原意，语言自然流畅。",
    messages: [{ role: "user", content: `请将以下文本翻译成${target}：\n\n${text}` }],
  });
}

/** 流式总结文章 */
export async function summarizeArticle(content: string) {
  return runStream({
    system: "你是一个内容总结助手。请用中文简洁地总结文章要点，用分点形式输出。",
    messages: [{ role: "user", content: `请总结以下文章的要点：\n\n${content.substring(0, 8000)}` }],
  });
}

/** 围绕文章的多轮流式对话：文章全文与引用放在 system，历史轮次保留上下文 */
export async function chatAboutArticle(options: {
  articleTitle: string;
  articleContent?: string;
  selection?: string;
  history: ChatTurn[];
}) {
  const { articleTitle, articleContent, selection, history } = options;
  const fullArticle = articleContent?.trim().substring(0, 8000) ?? "";
  // 引用片段太短时，从全文中定位并附带前后上下文，帮助模型理解指代
  let selectionBlock = "";
  if (selection?.trim()) {
    const source = articleContent ?? "";
    const index = source.indexOf(selection);
    const around =
      index >= 0
        ? source.slice(Math.max(0, index - 400), index + selection.length + 400)
        : selection;
    selectionBlock = `用户当前引用的原文（已附带前后上下文）：\n${around}`;
  }
  const system = [
    "你是一个专业的阅读助手，正在与用户围绕一篇文章对话。请用中文简洁地回答，帮助用户理解内容。",
    "重要：用户问题中的“这个/这段/它/原文”均指下方引用的原文；你必须结合文章全文与引用上下文作答，绝不要回复“没有上下文”或“不知道指什么”。",
    `文章标题：${articleTitle}`,
    fullArticle ? `文章全文（可能被截断）：\n${fullArticle}` : "",
    selectionBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
  return runStream({ system, messages: history });
}

/** 头脑风暴：围绕一个真实问题的推演对话，knowledge 为调用方注入的知识库相关片段 */
export async function brainstormStream(options: {
  question: string;
  knowledge?: string;
  references?: string;
  history: ChatTurn[];
}) {
  const { question, knowledge, references, history } = options;
  const system = [
    "你是「知识头脑风暴」的推演主持。你的任务是与用户围绕一个真实问题展开推演，而不是泛泛聊天。",
    "回答风格：中文、简洁、结构化（短标题 + 列表）；每轮给出 2-3 个推演角度或候选命题，并指出哪个最值得先验证。",
    "列举角度/方案/子问题时：每个条目单独成行、编号连续，格式固定为 **角度 1：xxx** / **角度 2：xxx**（冒号后一句话概括）；一轮里把所有值得探索的角度与子问题一次性抛全，不要分多轮逐个问。",
    "优先关联用户知识库里的已有内容；引用时用《标题》标明出处，帮助用户把旧知识接进新推演。",
    "用户挂载的参考资料是本次推演的事实底座：涉及事实、数据、原文观点时以参考资料为准，并标明出处。",
    `本次头脑风暴的问题：${question}`,
    knowledge ? `知识库相关片段（供引用与联想）：\n${knowledge}` : "",
    references ? `用户挂载的参考资料：\n${references}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return runStream({ system, messages: history });
}

/** 随手记 AI 整理：给出摘要、标签、建议归档文件夹（JSON，folder 必须从候选目录中选） */
export async function organizeNote(
  content: string,
  folders: string[] = [],
): Promise<{ summary: string; tags: string[]; folder: string }> {
  const folderHint =
    folders.length > 0
      ? `folder 必须从以下候选目录中选择最合适的一个（原样输出，不要自创）：${folders.join("、")}`
      : "folder 为建议归档的 Obsidian 文件夹（如 锦浪/电网、学习资料/软考、个人信息、00-Inbox）";
  const prompt = `请为下面的随手记内容做归类建议，输出 JSON 格式 {"summary": string, "tags": string[], "folder": string}。
summary 为一句话摘要（不超过 30 字）；tags 最多 3 个关键词；${folderHint}。

内容：
${content.slice(0, 4000)}`;

  let text: string;
  if (process.env.OPENAI_API_KEY && (await openAiReachable())) {
    const result = await generateText({
      model: getOpenAiModel(),
      system: "你是知识整理助手。只输出 JSON，不要输出其他内容。",
      prompt,
    });
    text = result.text;
  } else {
    const { host, model } = ollamaConfig();
    const response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        think: false,
        stream: false,
        messages: [
          { role: "system", content: "你是知识整理助手。只输出 JSON，不要输出其他内容。" },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Ollama 请求失败 (${response.status})`);
    const data = (await response.json()) as { message?: { content?: string } };
    text = data.message?.content ?? "";
  }

  const matched = text.match(/\{[\s\S]*\}/);
  const parsed = matched
    ? (JSON.parse(matched[0]) as { summary?: string; tags?: string[]; folder?: string })
    : {};
  return {
    summary: String(parsed.summary ?? ""),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((tag) => String(tag)).slice(0, 3) : [],
    folder: String(parsed.folder ?? "00-Inbox"),
  };
}
