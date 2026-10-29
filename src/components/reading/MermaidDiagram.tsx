"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Maximize2, Minus, Plus, ScanLine, SquarePen, Workflow, X } from "lucide-react";
import { useUiPrefs } from "@/lib/ui-prefs";
import { markDirty } from "@/lib/table-edit";
import { diagramLabel, enhanceMermaidSvg, peekMermaidCache, renderMermaid } from "@/lib/mermaid-render";

// 默认先给全貌（适应宽度）；缩放后文字低于此比例时，工具栏提示可切到原始尺寸细看
const MIN_READABLE_FIT_SCALE = 0.72;
const ZOOM_STEP = 0.2;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.4;

type FitMode = "fit" | "actual";

export function MermaidDiagram({
  source,
  editable = false,
}: {
  source: string;
  editable?: boolean;
}) {
  const { theme, accent } = useUiPrefs();
  const figureRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // 编辑态源码编辑：override 是已应用但尚未保存到文章的新源码，draft 是编辑器里的草稿
  const [override, setOverride] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const applied = override ?? source;
  const renderSource = draft ?? applied;
  // 输入停顿 400ms 再重绘预览：mermaid 渲染较重，不跟每次击键走；
  // 非草稿态（换主题/应用/外部更新）立即跟随
  const [debouncedSource, setDebouncedSource] = useState(renderSource);
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSource(renderSource),
      draft === null ? 0 : 400,
    );
    return () => clearTimeout(timer);
  }, [renderSource, draft]);
  const sourceEditing = draft !== null;
  const cacheKey = `${theme}:${accent}:${debouncedSource}`;
  // 渲染结果连同其 key 一起保存：key 变化（换主题/改源码）时自然回到 loading，无需在 effect 里重置
  const [result, setResult] = useState<{ key: string; svg: string; error: string } | null>(() => {
    const cached = peekMermaidCache(debouncedSource, theme, accent);
    return cached ? { key: cacheKey, svg: cached, error: "" } : null;
  });
  const current = result?.key === cacheKey ? result : null;
  const svg = current?.svg ?? "";
  const error = current?.error ?? "";
  const status: "loading" | "ready" | "error" = svg ? "ready" : error ? "error" : "loading";
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [fitMode, setFitMode] = useState<FitMode | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      const rendered = await renderMermaid(debouncedSource, theme, accent);
      if (cancelled) return;
      setResult({ key: cacheKey, ...rendered });
    }

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, debouncedSource, theme, accent]);

  // 读取 SVG 原始尺寸（viewBox），据此决定默认是适应宽度还是原尺寸滚动
  useLayoutEffect(() => {
    const element = viewportRef.current?.querySelector<SVGSVGElement>(".mermaid-diagram__canvas svg");
    if (!element) return;
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", `${diagramLabel(applied)}（Mermaid）`);
    enhanceMermaidSvg(element);
    const box = element.viewBox.baseVal;
    if (box && box.width > 0) setNatural({ width: box.width, height: box.height });
  }, [svg, applied]);

  // 全屏灯箱挂载的是同一份 SVG 的副本，语义着色跟随补齐
  useEffect(() => {
    if (!lightboxOpen) return;
    const element = dialogRef.current?.querySelector<SVGSVGElement>("svg");
    if (element) enhanceMermaidSvg(element);
  }, [lightboxOpen, svg]);

  // 原始尺寸模式首次出现时把水平视野对准图中心：见 effectiveMode 声明处的 effect
  const centeredKeyRef = useRef("");

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // ⌘/Ctrl + 滚轮（触控板捏合同事件）在指针位置缩放：先记指针在画布里的坐标，
  // 缩放绘制完成后把同一点拉回指针下方，缩放焦点不漂移
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const canvas = viewport.querySelector<HTMLElement>(".mermaid-diagram__canvas");
      if (!canvas) return;
      const rect = viewport.getBoundingClientRect();
      const originX = event.clientX - rect.left + viewport.scrollLeft - canvas.offsetLeft;
      const originY = event.clientY - rect.top + viewport.scrollTop - canvas.offsetTop;
      const step = event.deltaY < 0 ? 0.1 : -0.1;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((zoomRef.current + step) * 10) / 10));
      if (next === zoomRef.current) return;
      const factor = next / zoomRef.current;
      setZoom(next);
      requestAnimationFrame(() => {
        viewport.scrollLeft = originX * factor + canvas.offsetLeft - (event.clientX - rect.left);
        viewport.scrollTop = originY * factor + canvas.offsetTop - (event.clientY - rect.top);
      });
    }
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, []);

  // 溢出时按住拖拽平移：记录起点滚动位置，跟随指针反向滚动
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  function onPanStart(event: React.PointerEvent<HTMLDivElement>) {
    if (!overflowing || event.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.dataset.panning = "true";
  }

  function onPanMove(event: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    const viewport = viewportRef.current;
    if (!pan || !viewport || event.pointerId !== pan.pointerId) return;
    viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    viewport.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  }

  function onPanEnd(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport || panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    delete viewport.dataset.panning;
  }

  // 源码编辑器开着时按 ⌘/Ctrl+S：capture 阶段先于 Reader 的保存应用草稿，
  // 否则正在编辑的图表源码会被静默丢弃
  useEffect(() => {
    if (draft === null) return;
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (draft !== null && draft.trim() !== "") applyDraft();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const fitScale = natural && viewportWidth ? Math.min(1, viewportWidth / natural.width) : 1;
  const isCramped = fitScale < MIN_READABLE_FIT_SCALE;
  // 默认适应宽度给全貌；复杂图缩放后文字偏小时，「原始尺寸」按钮会带提示引导细看
  const effectiveMode: FitMode = fitMode ?? "fit";
  const scale = effectiveMode === "fit" ? fitScale * zoom : zoom;
  const overflowing = natural ? natural.width * fitScale < natural.width - 1 : false;
  const canvasStyle = natural
    ? { width: `${natural.width * scale}px`, height: `${natural.height * scale}px` }
    : undefined;

  // 原始尺寸模式首次出现时把水平视野对准图中心，避免打开就停在左缘空白；
  // 只做一次（key 含源码+模式），用户之后的缩放与拖拽不被抢占
  useLayoutEffect(() => {
    if (!natural || effectiveMode !== "actual") return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const key = `${cacheKey}:${effectiveMode}`;
    if (centeredKeyRef.current === key) return;
    centeredKeyRef.current = key;
    viewport.scrollLeft = (natural.width * scale - viewport.clientWidth) / 2;
  }, [svg, natural, effectiveMode, cacheKey, scale]);

  function changeZoom(delta: number) {
    setZoom((current) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((current + delta) * 10) / 10)));
  }

  function toggleFit() {
    const next: FitMode = effectiveMode === "fit" ? "actual" : "fit";
    setFitMode(next);
    setZoom(1);
    // 切到原始尺寸时把视口滚到图的水平中心，避免停在一片空白角落
    if (next === "actual" && natural) {
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (viewport) viewport.scrollLeft = (natural.width - viewport.clientWidth) / 2;
      });
    }
  }

  function openLightbox() {
    setLightboxOpen(true);
    dialogRef.current?.showModal();
  }

  function closeLightbox() {
    dialogRef.current?.close();
  }

  const label = diagramLabel(applied);

  function openSourceEditor() {
    setDraft(applied);
  }

  // 点「取消」时 blur 先于 click 触发：用 ref 拦住 blur 的自动应用
  const cancellingRef = useRef(false);

  function closeSourceEditor() {
    cancellingRef.current = false;
    setDraft(null);
    setDebouncedSource(applied);
  }

  // 应用草稿：更新预览、把新源码写回 DOM 的 data-source（保存时 serializeProse 从这里读回），
  // 并向正文派发 input 让 Reader 标记未保存修改
  function applyDraft() {
    if (draft === null) return;
    const next = draft.replace(/\s+$/, "");
    cancellingRef.current = false;
    setOverride(next);
    setDraft(null);
    setDebouncedSource(next);
    const figure = figureRef.current;
    if (figure) {
      figure.setAttribute("data-source", next);
      const prose = figure.closest<HTMLElement>(".reader-prose");
      if (prose) markDirty(prose);
    }
  }

  // 焦点离开源码框且不是点「取消」时：有改动自动应用，无改动直接收起，少一次点击
  function handleEditorBlur() {
    if (cancellingRef.current || draft === null) return;
    if (draft === applied) {
      closeSourceEditor();
      return;
    }
    if (draft.trim() !== "") applyDraft();
  }

  return (
    <figure
      ref={figureRef}
      className="mermaid-diagram"
      data-status={status}
      data-source={applied}
      // 编辑态下图块整体不可直接键入，改图表只能通过源码编辑器（textarea 不受影响）
      contentEditable={editable ? false : undefined}
      suppressContentEditableWarning
    >
      <figcaption>
        <span>
          <Workflow aria-hidden="true" /> {label}
          {override !== null && <small className="mermaid-diagram__unsaved">已改 · 未保存</small>}
        </span>
        <div className="mermaid-diagram__tools" role="toolbar" aria-label={`${label}视图`}>
          {status === "ready" && (
            <>
              <button type="button" onClick={() => changeZoom(-ZOOM_STEP)} aria-label="缩小" title="缩小">
                <Minus aria-hidden="true" />
              </button>
              <output aria-live="polite">{Math.round(scale * 100)}%</output>
              <button type="button" onClick={() => changeZoom(ZOOM_STEP)} aria-label="放大" title="放大">
                <Plus aria-hidden="true" />
              </button>
              {overflowing && (
                <button
                  type="button"
                  onClick={toggleFit}
                  data-hint={effectiveMode === "fit" && isCramped ? "true" : undefined}
                  aria-pressed={effectiveMode === "fit"}
                  title={effectiveMode === "fit" ? "原始尺寸（可横向滚动）" : "适应宽度"}
                >
                  <ScanLine aria-hidden="true" />
                  <span>{effectiveMode === "fit" ? "原始尺寸" : "适应宽度"}</span>
                </button>
              )}
              <button
                type="button"
                onClick={openLightbox}
                aria-label="全屏查看"
                title="全屏查看"
              >
                <Maximize2 aria-hidden="true" />
              </button>
            </>
          )}
          {editable && !sourceEditing && (
            <button
              type="button"
              contentEditable={false}
              suppressContentEditableWarning
              onClick={openSourceEditor}
              className="mermaid-diagram__edit-btn"
              aria-label="编辑图表源码"
              title={status === "error" ? "修复并编辑 Mermaid 源码" : "编辑 Mermaid 源码"}
            >
              <SquarePen aria-hidden="true" />
              <span>{status === "error" ? "修复源码" : "编辑源码"}</span>
            </button>
          )}
        </div>
        {!editable && status === "error" && <small>需要检查源码</small>}
      </figcaption>
      {sourceEditing && (
        <div
          className="mermaid-diagram__editor"
          contentEditable={false}
          suppressContentEditableWarning
        >
          <div className="mermaid-diagram__editor-head">
            <span>Mermaid 源码 · 预览随输入更新</span>
            <div className="mermaid-diagram__editor-actions">
              <button
                type="button"
                className="mermaid-editor-btn"
                // mousedown 早于 blur：先立旗，阻止 blur 的自动应用
                onMouseDown={() => {
                  cancellingRef.current = true;
                }}
                onClick={closeSourceEditor}
              >
                <X aria-hidden="true" /> 取消
              </button>
              <button
                type="button"
                className="mermaid-editor-btn mermaid-editor-btn--apply"
                onClick={applyDraft}
                disabled={draft === null || draft.trim() === ""}
              >
                <Check aria-hidden="true" /> 应用到图表
              </button>
            </div>
          </div>
          <textarea
            className="mermaid-diagram__source"
            value={draft ?? ""}
            spellCheck={false}
            aria-label="Mermaid 源码"
            rows={Math.min(16, Math.max(5, (draft ?? "").split("\n").length + 1))}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={handleEditorBlur}
            onKeyDown={(event) => {
              // Esc 先关源码编辑器，不冒泡去退出整个编辑态
              if (event.key === "Escape") {
                event.stopPropagation();
                closeSourceEditor();
              }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                applyDraft();
              }
              // Tab 在源码里缩进，不跳焦点
              if (event.key === "Tab") {
                event.preventDefault();
                const target = event.currentTarget;
                const { selectionStart, selectionEnd, value } = target;
                target.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
                target.selectionStart = target.selectionEnd = selectionStart + 2;
                setDraft(target.value);
              }
            }}
          />
          {status === "error" && draft !== null && (
            <p className="mermaid-diagram__editor-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              预览无法渲染：{error.split("\n").slice(0, 2).join(" ")}
            </p>
          )}
        </div>
      )}
      <div
        ref={viewportRef}
        className="mermaid-diagram__viewport"
        tabIndex={overflowing ? 0 : undefined}
        data-overflow={overflowing ? "true" : undefined}
        onPointerDown={onPanStart}
        onPointerMove={onPanMove}
        onPointerUp={onPanEnd}
        onPointerCancel={onPanEnd}
      >
        {status === "loading" && (
          <div className="mermaid-diagram__loading">
            <span /> 正在绘制{label}…
          </div>
        )}
        <div
          className="mermaid-diagram__canvas"
          style={canvasStyle}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {status === "error" && (
          <div className="mermaid-diagram__error" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>这段 Mermaid 语法暂时无法渲染</strong>
              <span>{error.split("\n").slice(0, 3).join(" ")}</span>
            </div>
          </div>
        )}
      </div>
      {status === "error" && !sourceEditing && (
        <details>
          <summary>查看原始 Mermaid</summary>
          <pre>
            <code>{applied}</code>
          </pre>
        </details>
      )}
      <dialog
        ref={dialogRef}
        className="mermaid-lightbox"
        aria-label={`${label}全屏查看`}
        onKeyDown={(event) => {
          // 只关闭灯箱，不让 Esc 冒泡去退出阅读器的宽屏/编辑态
          if (event.key === "Escape") event.stopPropagation();
        }}
        onClose={() => setLightboxOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeLightbox();
        }}
      >
        <header>
          <span>
            <Workflow aria-hidden="true" /> {label}
          </span>
          <button type="button" onClick={closeLightbox} aria-label="关闭全屏">
            <X aria-hidden="true" />
          </button>
        </header>
        {/* 只在打开时挂载副本，避免同一 SVG 的 id 在文档里长期重复 */}
        {lightboxOpen && (
          <div className="mermaid-lightbox__body" dangerouslySetInnerHTML={{ __html: svg }} />
        )}
      </dialog>
    </figure>
  );
}
