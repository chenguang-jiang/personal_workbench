import { chatOnce, type ChatTurn } from "@/lib/ai";

const TITLE_MAX_LENGTH = 28;

function compact(value: string) {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[(?:S\d+)\]/g, " ")
    .replace(/[#*_`>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function crop(value: string, suffix = "") {
  const characters = Array.from(value);
  return characters.length > TITLE_MAX_LENGTH
    ? `${characters.slice(0, TITLE_MAX_LENGTH).join("")}${suffix}`
    : value;
}

export function fallbackBrainstormTitle(question: string) {
  const normalized = compact(question)
    .replace(/^(请|帮我|我想|想要|如何|怎么)(?:帮我)?\s*/u, "")
    .replace(/[。！？?!.；;：:，,、]+$/u, "")
    .trim();
  return crop(normalized || "新的询问", "…");
}

function normalizeGeneratedTitle(value: string) {
  const firstLine = compact(value)
    .split(/\n|\r/)[0]
    ?.replace(/^(?:标题|会话标题)\s*[:：]\s*/u, "")
    .replace(/^[“”"'《》【】\s]+|[“”"'《》【】。！？?!.；;：:\s]+$/gu, "")
    .trim();
  return firstLine ? crop(firstLine) : "";
}

/**
 * 根据首轮交流提炼稳定、可扫描的会话标题。
 * 标题生成是增强能力：任何模型错误都会回退，不影响主问答链路。
 */
export async function generateBrainstormTitle(options: {
  question: string;
  messages: ChatTurn[];
}) {
  const fallback = fallbackBrainstormTitle(options.question);
  const transcript = options.messages
    .slice(-4)
    .map((turn) => `${turn.role === "user" ? "用户" : "助手"}：${compact(turn.content).slice(0, 320)}`)
    .join("\n");

  try {
    const result = await chatOnce({
      system:
        "你是会话标题编辑。根据用户真正想解决的问题，提炼一个便于在历史列表扫描的中文短标题。只输出标题本身，不要引号、句号、解释或 Markdown；优先使用 8-18 个汉字，必要的英文术语可保留。",
      messages: [
        {
          role: "user",
          content: `原始研究问题：${compact(options.question)}\n首轮交流：\n${transcript || "（暂无补充）"}`,
        },
      ],
      maxTokens: 60,
    });
    return normalizeGeneratedTitle(result) || fallback;
  } catch {
    return fallback;
  }
}

