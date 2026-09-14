"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Edge as VisEdge, Node as VisNode } from "vis-network";
import { ArrowUpRight, FileText, Search, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useUiPrefs } from "@/lib/ui-prefs";

interface GraphNode {
  id: string;
  label: string;
  group: string;
  tags: string[];
}

interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

type GraphPayload = { nodes: GraphNode[]; edges: GraphEdge[] };
type NetworkHandle = {
  destroy: () => void;
  selectNodes: (ids: string[]) => void;
  focus: (id: string, options?: { scale?: number; animation?: boolean }) => void;
};

const GROUPS = [
  { value: "all", label: "全部", color: "var(--color-primary)" },
  { value: "article", label: "文章", color: "var(--color-accent-purple)" },
  { value: "note", label: "笔记", color: "var(--color-accent-green)" },
  { value: "concept", label: "概念", color: "var(--color-accent-amber)" },
  { value: "material", label: "素材", color: "var(--color-secondary)" },
] as const;

const GROUP_COLORS: Record<string, string> = {
  article: "#6e35d9",
  note: "#2f9d68",
  concept: "#d38a1c",
  material: "#736c79",
};

export default function KnowledgeGraphPage() {
  const { t } = useUiPrefs();
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<NetworkHandle | null>(null);
  const [payload, setPayload] = useState<GraphPayload>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/graph?limit=500")
      .then((response) => response.json())
      .then((data: GraphPayload) => {
        if (active) setPayload(data);
      })
      .catch((error) => console.error("图谱加载失败:", error))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || payload.nodes.length === 0) return;
    let cancelled = false;

    async function renderNetwork() {
      const { Network, DataSet } = await import("vis-network/standalone");
      if (cancelled || !containerRef.current) return;

      networkRef.current?.destroy();
      const nodes = new DataSet<VisNode>(
        payload.nodes.map((node) => ({
          id: node.id,
          label: node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label,
          group: node.group,
          hidden: group !== "all" && node.group !== group,
          color: {
            background: GROUP_COLORS[node.group] || "#6e35d9",
            border: "#ffffff",
            highlight: { background: "#5f26c9", border: "#ffffff" },
            hover: { background: GROUP_COLORS[node.group] || "#6e35d9", border: "#5f26c9" },
          },
          font: { color: "#28222d", size: 11, face: "Inter, sans-serif" },
          shape: "dot",
          size: 11,
          borderWidth: 2,
        })),
      );
      const edges = new DataSet<VisEdge>(
        payload.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
          color: { color: "rgba(84,70,94,0.15)", highlight: "#6e35d9", hover: "#9c79e9" },
          width: 1,
          smooth: { enabled: true, type: "continuous", roundness: 0.35 },
        })),
      );

      type NetworkData = ConstructorParameters<typeof Network>[1];
      const instance = new Network(
        containerRef.current,
        { nodes, edges } as unknown as NetworkData,
        {
          autoResize: true,
          physics: {
            solver: "forceAtlas2Based",
            forceAtlas2Based: {
              gravitationalConstant: -34,
              centralGravity: 0.012,
              springLength: 120,
              springConstant: 0.035,
            },
            stabilization: { iterations: 90 },
          },
          interaction: { hover: true, tooltipDelay: 180, zoomView: true, dragView: true },
          nodes: { borderWidth: 2 },
        },
      );

      instance.on("selectNode", (params) => setSelectedId(String(params.nodes[0])));
      networkRef.current = instance as unknown as NetworkHandle;
    }

    renderNetwork();
    return () => {
      cancelled = true;
      networkRef.current?.destroy();
      networkRef.current = null;
    };
  }, [group, payload]);

  const selectedNode = useMemo(
    () => payload.nodes.find((node) => node.id === selectedId) ?? payload.nodes[0] ?? null,
    [payload.nodes, selectedId],
  );

  const relatedNodes = useMemo(() => {
    if (!selectedNode) return [];
    const relatedIds = payload.edges.flatMap((edge) => {
      if (edge.from === selectedNode.id) return [edge.to];
      if (edge.to === selectedNode.id) return [edge.from];
      return [];
    });
    return payload.nodes.filter((node) => relatedIds.includes(node.id)).slice(0, 6);
  }, [payload, selectedNode]);

  function findNode(value: string) {
    setSearch(value);
    const target = payload.nodes.find((node) =>
      `${node.label} ${node.tags.join(" ")}`.toLowerCase().includes(value.trim().toLowerCase()),
    );
    if (target && value.trim()) {
      setSelectedId(target.id);
      networkRef.current?.selectNodes([target.id]);
      networkRef.current?.focus(target.id, { scale: 1.25, animation: true });
    }
  }

  return (
    <div className="page-frame page-frame--wide">
      <PageHeader
        eyebrow="KNOWLEDGE GRAPH · LIVE VAULT"
        title={t("kg_title")}
        description={t("kg_desc", { n: payload.nodes.length, e: payload.edges.length })}
        actions={<span className="tag tag--purple"><Sparkles aria-hidden="true" /> {t("kg_live")}</span>}
      />

      <section className="graph-workspace panel">
        <aside className="graph-filters">
          <div>
            <p className="micro-label">GRAPH LENS</p>
            <h2>{t("know_title")}</h2>
          </div>
          <div className="graph-group-list">
            {GROUPS.map((item) => (
              <button
                type="button"
                key={item.value}
                className={group === item.value ? "graph-group graph-group--active" : "graph-group"}
                onClick={() => setGroup(item.value)}
              >
                <span style={{ background: item.color }} />
                <span>{item.label}</span>
                <strong>
                  {item.value === "all"
                    ? payload.nodes.length
                    : payload.nodes.filter((node) => node.group === item.value).length}
                </strong>
              </button>
            ))}
          </div>
          <div className="graph-help">
            <span>滚轮缩放</span>
            <span>拖拽浏览</span>
            <span>点击节点查看关联</span>
          </div>
        </aside>

        <div className="graph-canvas-shell">
          <label className="graph-search">
            <Search aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => findNode(event.target.value)}
              placeholder={`搜索 ${payload.nodes.length} 个知识节点…`}
            />
            <kbd>⌘ K</kbd>
          </label>
          <div ref={containerRef} className="graph-live-canvas" />
          {loading && (
            <div className="graph-loading" role="status">
              <span className="status-dot" /> 正在构建关系网络…
            </div>
          )}
        </div>

        <aside className="graph-detail">
          <div className="graph-detail-head">
            <p className="micro-label">LOCAL GRAPH</p>
            <span className="tag">{selectedNode?.group ?? "未选择"}</span>
          </div>
          {selectedNode ? (
            <>
              <h2>{selectedNode.label}</h2>
              <div className="graph-tags">
                {selectedNode.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}
              </div>
              <p className="graph-related-title">相关页面 · {relatedNodes.length}</p>
              {relatedNodes.length > 0 ? (
                <div className="graph-related-list">
                  {relatedNodes.map((node) => (
                    <button type="button" key={node.id} onClick={() => setSelectedId(node.id)}>
                      <FileText aria-hidden="true" />
                      <span>{node.label}</span>
                      <ArrowUpRight aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="graph-empty">该节点暂无真实关联，Vault 同步发现 wikilink 后会出现在这里。</p>
              )}
            </>
          ) : (
            <p className="graph-empty">点击任一节点查看局部关系。</p>
          )}
        </aside>
      </section>
    </div>
  );
}
