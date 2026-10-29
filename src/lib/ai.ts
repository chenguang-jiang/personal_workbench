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

/**
 * DeepSeek 兜底：云端部署了 DEEPSEEK_API_KEY 但没有 OPENAI_API_KEY 时，
 * 用 DeepSeek 官方 API（OpenAI 兼容）为阅读 AI 和头脑风暴提供推理能力。
 */
function deepSeekConfig() {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
  };
}

function hasDeepSeek(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
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

// DeepSeek 可达性探测（5 分钟缓存）
let deepSeekProbeCache: { at: number; ok: boolean } | null = null;
async function deepSeekReachable(): Promise<boolean> {
  if (deepSeekProbeCache && Date.now() - deepSeekProbeCache.at < 5 * 60_000) return deepSeekProbeCache.ok;
  let ok = false;
  try {
    const { apiKey, baseURL, model } = deepSeekConfig();
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
    });
    ok = response.ok;
  } catch {
    ok = false;
  }
  deepSeekProbeCache = { at: Date.now(), ok };
  return ok;
}

/** 获取当前可用的 AI 后端标签，供 runStream/chatOnce 决策 */
async function getAvailableProvider(): Promise<"openai" | "deepseek" | "ollama"> {
  if (process.env.OPENAI_API_KEY && (await openAiReachable())) return "openai";
  if (hasDeepSeek() && (await deepSeekReachable())) return "deepseek";
  return "ollama";
}

/** 探测当前 AI 后端是否可用（OpenAI key 优先，其次 DeepSeek，最后本地 Ollama） */
export async function getAiStatus(): Promise<AiStatus> {
  if (process.env.OPENAI_API_KEY) {
    const { model } = openAiConfig();
    if (await openAiReachable()) {
      return { provider: "openai", model, available: true, detail: `云端 · ${model}` };
    }
  }
  if (hasDeepSeek()) {
    const { model } = deepSeekConfig();
    if (await deepSeekReachable()) {
      return { provider: "openai", model, available: true, detail: `DeepSeek · ${model}` };
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
  /** 该轮附带的图片（data URL）；仅视觉模型会真正收到，文本模型由调用方降级为文字说明 */
  images?: string[];
}

/** 常见视觉模型族；OpenAI 兼容代理后面的纯文本模型（如 qwen-max）不在此列 */
const VISION_MODEL_PATTERN = /(?:gpt-4o|gpt-4\.1|gpt-5|^o[134]|claude|gemini|qwen[-.]?vl|llava|vision)/i;

/**
 * 当前可用后端是否支持看图：仅 OpenAI 兼容端点可能多模态，且模型名需命中视觉族；
 * DAWNKB_AI_VISION=1/0 可强制开关。文本后端（DeepSeek/Ollama）一律按纯文本处理。
 */
export async function aiSupportsVision(): Promise<boolean> {
  if (process.env.DAWNKB_AI_VISION === "0") return false;
  if ((await getAvailableProvider()) !== "openai") return false;
  if (process.env.DAWNKB_AI_VISION === "1") return true;
  return VISION_MODEL_PATTERN.test(openAiConfig().model);
}

/** 视觉消息：图片以 content parts 发送；无图轮次原样返回 */
function toVisionMessage(turn: ChatTurn) {
  if (turn.role !== "user" || !turn.images?.length) return turn;
  return {
    role: turn.role,
    content: [
      { type: "text" as const, text: turn.content },
      ...turn.images.map((image) => ({ type: "image" as const, image })),
    ],
  };
}

/** 纯文本后端的消息：剥离图片字段，避免上游 400 */
function toTextMessage(turn: ChatTurn) {
  if (!turn.images?.length) return turn;
  return { role: turn.role, content: turn.content };
}

function streamErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "AI 流式输出失败";
}

/**
 * 把 ai-sdk 的全量事件流转成纯文本字节流。
 * 模型/网络错误以 error 事件出现在流中（不会抛出），必须显式 controller.error()，
 * 否则文本流会“正常结束”，客户端只能看到空白或被截断的回答。
 */
function wrapTextStream(
  parts: AsyncIterable<{ type: string; text?: string; error?: unknown }>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const part of parts) {
          if (part.type === "text-delta" && part.text) {
            controller.enqueue(encoder.encode(part.text));
          } else if (part.type === "error") {
            throw new Error(streamErrorMessage(part.error));
          }
        }
      } catch (error) {
        console.error("[ai] 流式输出失败", error);
        controller.error(error instanceof Error ? error : new Error(streamErrorMessage(error)));
        return;
      }
      controller.close();
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

/** 把 OpenAI/DeepSeek 兼容的 SSE 流转成纯文本字节流 */
function wrapOpenAiStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
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
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data) as {
                choices?: { delta?: { content?: string } }[];
                error?: { message?: string } | string;
              };
              if (parsed.error) {
                const msg = typeof parsed.error === "string" ? parsed.error : parsed.error.message;
                throw new Error(msg || "DeepSeek 流式错误");
              }
              const content = parsed.choices?.[0]?.delta?.content ?? "";
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

/** 统一流式入口：OpenAI 走 ai-sdk，DeepSeek 走原生流式，Ollama 走原生接口（think:false 关闭思考提速） */
export async function runStream(options: {
  system: string;
  messages: ChatTurn[];
}): Promise<ReadableStream<Uint8Array>> {
  const { system, messages } = options;
  const provider = await getAvailableProvider();
  if (provider === "openai") {
    const result = streamText({
      model: getOpenAiModel(),
      system,
      messages: messages.map(toVisionMessage),
      // 错误已通过 stream 中的 error 事件交给 wrapTextStream 传播，这里只做服务端日志
      onError: ({ error }) => console.error("[ai] streamText 错误", error),
    });
    return wrapTextStream(result.stream);
  }
  if (provider === "deepseek") {
    const { apiKey, baseURL, model } = deepSeekConfig();
    const upstream = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: "system", content: system }, ...messages.map(toTextMessage)],
      }),
    });
    if (!upstream.ok || !upstream.body) throw new Error(`DeepSeek 请求失败 (${upstream.status})`);
    return wrapOpenAiStream(upstream.body);
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
      messages: [{ role: "system", content: system }, ...messages.map(toTextMessage)],
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
  const provider = await getAvailableProvider();
  if (provider === "openai") {
    const result = await generateText({
      model: getOpenAiModel(),
      system,
      messages: messages.map(toVisionMessage),
      maxOutputTokens: maxTokens,
    });
    return result.text;
  }
  if (provider === "deepseek") {
    const { apiKey, baseURL, model } = deepSeekConfig();
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, ...messages.map(toTextMessage)],
      }),
    });
    if (!response.ok) throw new Error(`DeepSeek 请求失败 (${response.status})`);
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }
  const { host, model } = ollamaConfig();
  const response = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      think: false,
      stream: false,
      messages: [{ role: "system", content: system }, ...messages.map(toTextMessage)],
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
    "你是一个专业的知识库 Agent（智能阅读与编辑助理）。你不仅能解答关于文章的任何疑问，还拥有协同修改、润色、重构与排版文章的 Agent 权限。",
    "重要：用户问题中的“这个/这段/它/原文”均指下方引用的原文；你必须结合文章全文与引用上下文作答，绝不要回复“没有上下文”或“不知道指什么”。",
    "修改意图处理原则：若用户的输入表达了修改、删除、增补、润色、纠错或重新排版的意图（如“删除xxx”、“把xxx改成yyy”、“润色第2节”）：",
    "1. 必须以积极执行修改的 Agent 身份作答，指出具体修改位置，并给出修改后的完整文本建议；",
    "2. 严禁回答“我无法直接修改你的原文”、“我只是个语言模型没有权限修改”等拒绝托词！系统界面已为用户配备了「让 Agent 自动修改并应用到文章」按钮，你应明确告知用户：“我已为您起草修改方案，您可以直接点击下方按钮一键应用修改到文章正文。”",
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
  const provider = await getAvailableProvider();
  if (provider === "openai") {
    const result = await generateText({
      model: getOpenAiModel(),
      system: "你是知识整理助手。只输出 JSON，不要输出其他内容。",
      prompt,
    });
    text = result.text;
  } else if (provider === "deepseek") {
    const { apiKey, baseURL, model } = deepSeekConfig();
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是知识整理助手。只输出 JSON，不要输出其他内容。" },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) throw new Error(`DeepSeek 请求失败 (${response.status})`);
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    text = data.choices?.[0]?.message?.content ?? "";
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
