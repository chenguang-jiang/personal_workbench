"use client";

/**
 * Mermaid 渲染的共享管线：源码容错、设计令牌主题化、结果缓存。
 * MermaidDiagram 组件与编辑工具栏的「插入流程图」共用，保证所见一致。
 */

// Mermaid 对标签里的 ( ) " * 等特殊字符很严格：笔记里常见的宽松写法（如 EXE[下发执行器(接口)]）
// 会直接解析失败。这里在渲染前给“未加引号且含特殊字符”的标签整体补上引号，原文（data-source）保持不变。
const LABEL_SHAPE_RE =
  /(\[\()([^\[\]]*?)(\)\])|(\[)([^\[\]]*?)(\])|(\{\{)([^{}]*?)(\}\})|(\{)([^{}]*?)(\})/g;

// 边标签：A -.->|含(括号)的说明| B 这种未加引号的 |...| 同样会炸
const EDGE_LABEL_RE = /(-->|---|-\.->|-\.-|==>|--[xo])\|([^|\n]+)\|/g;

export const DIAGRAM_LABELS: Array<[RegExp, string]> = [
  [/^(flowchart|graph)\b/, "流程图"],
  [/^sequenceDiagram\b/, "时序图"],
  [/^classDiagram\b/, "类图"],
  [/^stateDiagram/, "状态图"],
  [/^erDiagram\b/, "实体关系图"],
  [/^gantt\b/, "甘特图"],
  [/^mindmap\b/, "思维导图"],
  [/^timeline\b/, "时间线"],
  [/^pie\b/, "饼图"],
  [/^journey\b/, "用户旅程"],
  [/^gitGraph\b/, "Git 分支图"],
];

const SVG_CACHE_LIMIT = 40;
const svgCache = new Map<string, string>();

export function firstLine(source: string) {
  return source.split("\n").find((line) => line.trim())?.trim() ?? "";
}

export function diagramLabel(source: string) {
  const head = firstLine(source);
  return DIAGRAM_LABELS.find(([pattern]) => pattern.test(head))?.[1] ?? "图表";
}

function sanitizeMermaidSource(source: string): string {
  // 只对 flowchart/graph 做标签容错：stateDiagram 的 [*] 起止符、classDiagram/erDiagram
  // 的多行类体/实体体都是合法语法，加引号反而会弄坏
  if (!/^(flowchart|graph)\b/.test(firstLine(source))) return source;
  source = source.replace(EDGE_LABEL_RE, (match, arrow: string, inner: string) => {
    const trimmed = inner.trim();
    if (!trimmed || trimmed.startsWith('"') || trimmed.startsWith("'")) return match;
    if (!/[()"*{}@]/.test(trimmed)) return match;
    return `${arrow}|"${trimmed.replace(/"/g, "#quot;")}"|`;
  });
  return source.replace(LABEL_SHAPE_RE, (...args) => {
    const match = args[0] as string;
    const groups = args.slice(1, 13) as Array<string | undefined>;
    const [o1, i1, c1, o2, i2, c2, o3, i3, c3, o4, i4, c4] = groups;
    const open = o1 ?? o2 ?? o3 ?? o4;
    const inner = i1 ?? i2 ?? i3 ?? i4;
    const close = c1 ?? c2 ?? c3 ?? c4;
    if (open === undefined || inner === undefined || close === undefined) return match;
    const trimmed = inner.trim();
    if (!trimmed || trimmed.startsWith('"') || trimmed.startsWith("'")) return match;
    if (trimmed.includes("\n")) return match;
    // @ 在 mermaid 11 是 @{ shape } 新语法的 token，未加引号必炸
    if (!/[()"*{}@]/.test(trimmed)) return match;
    return `${open}"${trimmed.replace(/"/g, "#quot;")}"${close}`;
  });
}

// Mermaid 的颜色库不认识 oklch / color-mix：借 canvas 把设计令牌解析成 sRGB hex
function resolveTokenColors(names: string[]): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const result: Record<string, string> = {};
  for (const name of names) {
    const value = styles.getPropertyValue(name).trim();
    if (!ctx || !value) continue;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    result[name] = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }
  return result;
}

function buildMermaidConfig(isDark: boolean) {
  const c = resolveTokenColors([
    "--color-surface",
    "--color-elevated",
    "--color-primary",
    "--color-secondary",
    "--color-border",
    "--color-border-strong",
    "--color-accent-purple",
    "--color-accent-lilac",
    "--color-accent-green",
    "--color-accent-amber",
  ]);
  const fontFamily = getComputedStyle(document.body).fontFamily;
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    suppressErrorRendering: true,
    theme: "base" as const,
    darkMode: isDark,
    fontFamily,
    flowchart: { curve: "basis" as const, htmlLabels: true, useMaxWidth: false, padding: 14 },
    sequence: { useMaxWidth: false },
    themeVariables: {
      darkMode: isDark,
      fontFamily,
      fontSize: "15px",
      background: c["--color-surface"],
      mainBkg: c["--color-accent-lilac"],
      primaryColor: c["--color-accent-lilac"],
      primaryTextColor: c["--color-primary"],
      primaryBorderColor: c["--color-accent-purple"],
      secondaryColor: c["--color-elevated"],
      secondaryBorderColor: c["--color-border-strong"],
      tertiaryColor: c["--color-surface"],
      tertiaryBorderColor: c["--color-border"],
      lineColor: c["--color-secondary"],
      textColor: c["--color-primary"],
      nodeTextColor: c["--color-primary"],
      clusterBkg: c["--color-elevated"],
      clusterBorder: c["--color-border-strong"],
      edgeLabelBackground: c["--color-surface"],
      noteBkgColor: c["--color-elevated"],
      noteBorderColor: c["--color-accent-amber"],
      actorBkg: c["--color-accent-lilac"],
      actorBorder: c["--color-accent-purple"],
      signalColor: c["--color-secondary"],
      git0: c["--color-accent-purple"],
      git1: c["--color-accent-green"],
      git2: c["--color-accent-amber"],
    },
  };
}

export type MermaidRenderResult = { svg: string; error: string };

let renderSeq = 0;

/** 渲染并缓存；同一份源码 + 主题（含强调色）只渲染一次 */
export async function renderMermaid(
  source: string,
  theme: string,
  accent: string,
): Promise<MermaidRenderResult> {
  const cacheKey = `${theme}:${accent}:${source}`;
  const cached = svgCache.get(cacheKey);
  if (cached) return { svg: cached, error: "" };
  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize(buildMermaidConfig(theme === "dark"));
    renderSeq += 1;
    const { svg: rendered } = await mermaid.render(
      `dawnkb-mermaid-r${renderSeq}`,
      sanitizeMermaidSource(source).trim(),
    );
    if (svgCache.size >= SVG_CACHE_LIMIT) {
      svgCache.delete(svgCache.keys().next().value as string);
    }
    svgCache.set(cacheKey, rendered);
    return { svg: rendered, error: "" };
  } catch (caught) {
    return {
      svg: "",
      error: caught instanceof Error ? caught.message : "无法解析这段 Mermaid 图表",
    };
  }
}

export function peekMermaidCache(source: string, theme: string, accent: string) {
  return svgCache.get(`${theme}:${accent}:${source}`) ?? "";
}

/**
 * 形状语义着色（展示时叠加，不进缓存）：起点/终点（胶囊、圆）偏绿、
 * 判断（菱形）偏琥珀、普通节点保持主题紫——和大厂文档流程图同一套视觉语言。
 * 用设计令牌的 color-mix 内联上色，明暗主题自动跟随；对缓存的 SVG 字符串零侵入。
 *
 * mermaid 11 的可见形状：普通/圆角矩形是 rect，菱形是 polygon（梯形等同为
 * polygon，靠「正菱形」几何区分），胶囊是纯三次曲线的 path（圆柱等带弧线
 * 直线段，以此排除），圆形是 circle。节点内另有透明命中框 rect，须绕开。
 */
export function enhanceMermaidSvg(svg: SVGSVGElement) {
  for (const node of svg.querySelectorAll<SVGGElement>(".node")) {
    const direct = node.querySelector<SVGGraphicsElement>(
      ":scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, :scope > path, :scope > g",
    );
    if (!direct) continue;
    const shape =
      direct.tagName.toLowerCase() === "g"
        ? direct.querySelector<SVGGraphicsElement>("path")
        : direct;
    if (!shape) continue;

    const tag = shape.tagName.toLowerCase();
    let role: "terminal" | "decision" | null = null;
    if (tag === "circle" || tag === "ellipse") {
      role = "terminal";
    } else if (tag === "polygon") {
      // 正菱形（宽≈高）才判为判断节点；梯形/平行四边形等 I/O 形状保持主题色
      const points = (shape.getAttribute("points") || "")
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number));
      if (points.length >= 3 && points.every((p) => p.length === 2 && p.every(Number.isFinite))) {
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        const width = Math.max(...xs) - Math.min(...xs);
        const height = Math.max(...ys) - Math.min(...ys);
        if (width > 0 && height > 0 && Math.abs(width - height) <= Math.max(width, height) * 0.3) {
          role = "decision";
        }
      }
    } else if (tag === "path") {
      // 胶囊的轮廓只含 M/C/Z 曲线段；圆柱等混合了弧线与直线段，排除
      const commands = (shape.getAttribute("d") || "").match(/[a-zA-Z]/g) || [];
      if (commands.length > 0 && commands.every((c) => "mcz".includes(c.toLowerCase()))) {
        role = "terminal";
      }
    } else if (tag === "rect") {
      // 兜底：个别渲染路径里胶囊退化为 rect（rx ≈ 高度一半）；普通圆角矩形 rx 远小于此
      const rx = parseFloat(shape.getAttribute("rx") || "0");
      const height = parseFloat(shape.getAttribute("height") || "0");
      if (height > 0 && rx >= height / 2 - 1) role = "terminal";
    }
    if (!role) continue;

    const token = role === "terminal" ? "--color-accent-green" : "--color-accent-amber";
    shape.style.fill = `color-mix(in oklab, var(${token}) 26%, var(--color-surface))`;
    shape.style.stroke = `color-mix(in oklab, var(${token}) 58%, var(--color-surface))`;
  }
}
