import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SECRET_PATH =
  /(^|[/\\])(?:\.env(?:\.|$)|\.git(?:[/\\]|$)|credentials?(?:\.|[/\\]|$)|secrets?(?:\.|[/\\]|$)|id_(?:rsa|ed25519)|[^/\\]+\.(?:pem|key|p12)$)/i;

const FORBIDDEN_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|\s)sudo(\s|$)/i, reason: "Dawn Agent 禁止提权命令" },
  {
    pattern:
      /(^|\s)(?:git\s+(?:commit|push|reset|clean)|gh\s+pr\s+create)(\s|$)/i,
    reason: "提交、推送和发布必须由你在终端中手动执行",
  },
  {
    pattern:
      /(?:^|\s)(?:deploy|vercel\s+deploy|npm\s+publish|docker\s+push)(?:\s|$)/i,
    reason: "Dawn Agent 不自动部署或发布",
  },
  {
    pattern: /rm\s+-[^\n]*r[^\n]*f\s+(?:\/|~|\$HOME)(?:\s|$)/i,
    reason: "禁止删除根目录或用户目录",
  },
  {
    pattern: /(?:>|>>|tee\s+)[^\n]*(?:\.git[/\\]|\.env(?:\s|$|\.))/i,
    reason: "禁止写入 .git 或密钥文件",
  },
];

export function canonicalProjectRoot(input: string) {
  const expanded = input.trim().replace(/^~(?=\/|$)/, os.homedir());
  if (!expanded) throw new Error("请选择项目文件夹");
  const absolute = path.resolve(expanded);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    throw new Error("项目文件夹不存在");
  }
  const realPath = fs.realpathSync(absolute);
  if (
    realPath === path.parse(realPath).root ||
    realPath === fs.realpathSync(os.homedir())
  ) {
    throw new Error("不能把磁盘根目录或整个用户目录注册为项目");
  }
  return realPath;
}

export function isInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function resolveProjectPath(root: string, input: unknown) {
  const raw = typeof input === "string" && input.trim() ? input.trim() : ".";
  const absolute = path.resolve(root, raw);
  if (!isInsideRoot(root, absolute)) throw new Error("路径超出已授权项目");
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const realExisting = fs.existsSync(existing)
    ? fs.realpathSync(existing)
    : existing;
  if (!isInsideRoot(root, realExisting))
    throw new Error("路径通过符号链接指向项目外部");
  if (SECRET_PATH.test(path.relative(root, absolute)))
    throw new Error("密钥或版本控制元数据默认不可访问");
  return absolute;
}

export function inspectBashCommand(command: string) {
  const text = command.trim();
  if (!text) {
    return {
      action: "block" as const,
      reason: "命令不能为空",
      riskLevel: "critical",
    };
  }
  for (const rule of FORBIDDEN_COMMANDS) {
    if (rule.pattern.test(text))
      return {
        action: "block" as const,
        reason: rule.reason,
        riskLevel: "critical",
      };
  }
  if (SECRET_PATH.test(text)) {
    return {
      action: "block" as const,
      reason: "命令可能读取或写入密钥文件",
      riskLevel: "critical",
    };
  }
  if (/\$\(|`/.test(text)) {
    return {
      action: "block" as const,
      reason: "Bash 命令不能通过命令替换构造动态路径或子命令",
      riskLevel: "critical",
    };
  }
  if (
    /(?:^|[\s"'=])(?:\.\.(?:[/\s]|$)|~(?:[/\s]|$)|\/(?:[^/\s"']|$)|\$[A-Za-z_{])/i.test(
      text,
    )
  ) {
    return {
      action: "block" as const,
      reason: "Bash 命令不能使用绝对路径、上级目录或动态路径",
      riskLevel: "critical",
    };
  }
  if (/^pwd\s*$/.test(text)) {
    return {
      action: "allow" as const,
      reason: "仅返回已授权工作目录",
      riskLevel: "low",
    };
  }
  const shellControl = /(?:^|[^\\])(?:[;&|<>\n\r]|\$\(|`)/.test(text);
  const highRisk =
    shellControl ||
    /\b(?:rm|mv|chmod|chown|curl|wget|ssh|scp|npm\s+(?:install|i)|pnpm\s+(?:install|add)|yarn\s+add)\b/i.test(
      text,
    );
  return {
    action: "approve" as const,
    reason: highRisk
      ? "命令包含复合执行、文件修改、依赖安装或网络访问"
      : "Bash 命令需要逐次确认",
    riskLevel: highRisk ? "high" : "medium",
  };
}

export function redactForLog(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const text = JSON.stringify(value, (key, item) => {
    if (/token|secret|password|authorization|api.?key/i.test(key))
      return "<redacted>";
    if (typeof item === "string") {
      return item
        .replace(/(?:sk|key|token)-[A-Za-z0-9_-]{12,}/g, "<redacted>")
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>")
        .slice(0, 12_000);
    }
    if (item && typeof item === "object") {
      if (seen.has(item)) return "<circular>";
      seen.add(item);
    }
    return item;
  });
  if (!text) return {};
  return JSON.parse(text);
}

export function summarizeTool(
  toolName: string,
  input: Record<string, unknown>,
  reason: string,
) {
  if (toolName === "bash")
    return reason + "：" + String(input.command ?? "").slice(0, 280);
  return (
    reason + "：" + toolName + " " + String(input.path ?? "").slice(0, 240)
  );
}
