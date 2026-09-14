"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Workflow } from "lucide-react";

let mermaidInitialized = false;

// Mermaid 对标签里的 ( ) " * 等特殊字符很严格：笔记里常见的宽松写法（如 EXE[下发执行器(接口)]）
// 会直接解析失败。这里在渲染前给“未加引号且含特殊字符”的标签整体补上引号，原文（data-source）保持不变。
const LABEL_SHAPE_RE =
  /(\[\()([^\[\]]*?)(\)\])|(\[)([^\[\]]*?)(\])|(\{\{)([^{}]*?)(\}\})|(\{)([^{}]*?)(\})/g;

// 边标签：A -.->|含(括号)的说明| B 这种未加引号的 |...| 同样会炸
const EDGE_LABEL_RE = /(-->|---|-\.->|-\.-|==>|--[xo])\|([^|\n]+)\|/g;

function sanitizeMermaidSource(source: string): string {
  // 只对 flowchart/graph 做标签容错：stateDiagram 的 [*] 起止符、classDiagram/erDiagram
  // 的多行类体/实体体都是合法语法，加引号反而会弄坏
  const firstLine = source.split("\n").find((line) => line.trim())?.trim() ?? "";
  if (!/^(flowchart|graph)\b/.test(firstLine)) return source;
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

export function MermaidDiagram({ source }: { source: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diagramId = `dawnkb-mermaid-${useId().replaceAll(":", "")}`;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    async function renderDiagram() {
      setStatus("loading");
      setError("");
      try {
        const mermaid = (await import("mermaid")).default;
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "base",
            fontFamily: "Inter, PingFang SC, Microsoft YaHei, sans-serif",
            flowchart: { curve: "basis", htmlLabels: true, useMaxWidth: true },
            themeVariables: {
              background: "#ffffff",
              primaryColor: "#f0e8ff",
              primaryTextColor: "#21182a",
              primaryBorderColor: "#8b45ef",
              lineColor: "#8b45ef",
              secondaryColor: "#f7f4f9",
              tertiaryColor: "#eaf8f0",
              clusterBkg: "#fbf9fc",
              clusterBorder: "#d9cfdf",
              edgeLabelBackground: "#ffffff",
              fontSize: "14px",
            },
          });
          mermaidInitialized = true;
        }

        const { svg, bindFunctions } = await mermaid.render(
          diagramId,
          sanitizeMermaidSource(source).trim(),
        );
        if (cancelled || !container) return;
        container.innerHTML = svg;
        const svgElement = container.querySelector("svg");
        svgElement?.removeAttribute("height");
        svgElement?.setAttribute("width", "100%");
        svgElement?.setAttribute("aria-label", "Mermaid 流程图");
        svgElement?.setAttribute("role", "img");
        bindFunctions?.(container);
        setStatus("ready");
      } catch (caught) {
        if (cancelled) return;
        if (container) container.innerHTML = "";
        setError(caught instanceof Error ? caught.message : "无法解析这段 Mermaid 图表");
        setStatus("error");
      }
    }

    void renderDiagram();
    return () => {
      cancelled = true;
      if (container) container.innerHTML = "";
    };
  }, [diagramId, source]);

  return (
    <figure className="mermaid-diagram" data-status={status} data-source={source}>
      <figcaption>
        <span><Workflow aria-hidden="true" /> 流动图</span>
        <small>{status === "ready" ? "LIVE" : status === "error" ? "CHECK SOURCE" : "RENDERING"}</small>
      </figcaption>
      <div className="mermaid-diagram__viewport">
        {status === "loading" && <div className="mermaid-diagram__loading"><span /> 正在构建流程…</div>}
        <div ref={containerRef} className="mermaid-diagram__canvas" />
        {status === "error" && (
          <div className="mermaid-diagram__error" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>这段 Mermaid 语法暂时无法渲染</strong>
              <span>{error.split("\n")[0]}</span>
            </div>
          </div>
        )}
      </div>
      {status === "error" && (
        <details>
          <summary>查看原始 Mermaid</summary>
          <pre><code>{source}</code></pre>
        </details>
      )}
    </figure>
  );
}
