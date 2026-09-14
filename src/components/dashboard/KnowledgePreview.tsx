import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { GraphPreview } from "@/lib/dashboard-data";
import type { TFunc } from "@/lib/i18n";

const KIND_COLORS: Record<GraphPreview["nodes"][number]["kind"], string> = {
  hub: "var(--color-accent-purple)",
  new: "var(--color-accent-green)",
  normal: "var(--color-primary)",
};

export function KnowledgePreview({
  nodeCount,
  linkCount,
  preview,
  t,
}: {
  nodeCount: number;
  linkCount: number;
  preview: GraphPreview;
  t: TFunc;
}) {
  return (
    <section className="panel knowledge-preview">
      <div className="panel-heading">
        <div>
          <p className="micro-label">KNOWLEDGE GRAPH</p>
          <h2>{t("dash_growing")}</h2>
        </div>
        <Link href="/dashboard/knowledge" className="button button-secondary">
          {t("graph_enter")} <ArrowUpRight aria-hidden="true" />
        </Link>
      </div>
      <div className="knowledge-preview-canvas">
        {preview.nodes.length >= 2 ? (
          <svg viewBox="0 0 100 100" role="img" aria-label={t("graph_aria")}>
            <g className="knowledge-lines">
              {preview.edges.map((edge, index) => (
                <line key={index} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
              ))}
            </g>
            <g>
              {preview.nodes.map((node, index) => (
                <circle
                  key={node.id}
                  className="knowledge-node"
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={KIND_COLORS[node.kind]}
                  style={{ animationDelay: `${index * -170}ms` }}
                >
                  <title>{node.label}</title>
                </circle>
              ))}
            </g>
          </svg>
        ) : (
          <p className="knowledge-preview-empty">{t("graph_empty")}</p>
        )}
        <div className="knowledge-legend" aria-hidden="true">
          <span><i style={{ background: "var(--color-accent-purple)" }} />{t("legend_hub")}</span>
          <span><i style={{ background: "var(--color-accent-green)" }} />{t("legend_recent")}</span>
          <span><i style={{ background: "var(--color-primary)" }} />{t("legend_active")}</span>
        </div>
        <div className="graph-stat graph-stat--left">
          <strong>{nodeCount.toLocaleString("zh-CN")}</strong>
          <span>JCG pages</span>
        </div>
        <div className="graph-stat graph-stat--right">
          <strong>{linkCount.toLocaleString("zh-CN")}</strong>
          <span>wikilinks</span>
        </div>
      </div>
    </section>
  );
}
