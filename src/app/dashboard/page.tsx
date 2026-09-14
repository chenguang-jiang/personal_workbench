import Link from "next/link";
import { cookies } from "next/headers";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FileText,
  Sparkles,
} from "lucide-react";
import { KnowledgePreview } from "@/components/dashboard/KnowledgePreview";
import { SpiderCompanion } from "@/components/dashboard/SpiderCompanion";
import { PageHeader } from "@/components/ui/PageHeader";
import { getDashboardData, type DashboardActivity } from "@/lib/dashboard-data";
import { makeT, parseLocale } from "@/lib/i18n";

export default async function DashboardPage() {
  const data = await getDashboardData();
  const store = await cookies();
  const locale = parseLocale(store.get("dawnkb-locale")?.value);
  const t = makeT(locale);
  const numberFormatter = new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN");
  const dateFormatter = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Shanghai",
  });
  const shortDateFormatter = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  });
  const formatDate = (value: string | Date) =>
    shortDateFormatter.format(new Date(value)).replace("/", "-");
  const metrics = [
    { label: t("m_docs"), value: data.articleCount, caption: t("m_docs_c"), purple: true },
    { label: t("m_folders"), value: data.folderCount, caption: t("m_folders_c") },
    { label: t("m_tags"), value: data.tagCount, caption: t("m_tags_c") },
    { label: t("m_links"), value: data.linkCount, caption: t("m_links_c"), purple: true },
    { label: t("m_annot"), value: data.annotationCount, caption: t("m_annot_c") },
    { label: t("m_week"), value: data.updatedThisWeek, caption: t("m_week_c") },
  ];

  return (
    <div className="page-frame page-frame--wide">
      <PageHeader
        eyebrow={`DAWN KNOWLEDGE BASE · ${dateFormatter.format(new Date())}`}
        title={t("dash_title")}
        description={t("dash_desc")}
        actions={<SpiderCompanion />}
      />

      <div className="dashboard-status-row">
        <span><span className="status-dot" /> {t("dash_vault", { name: data.vaultName })}</span>
        <span className="tag tag--purple">{t("dash_articles", { n: numberFormatter.format(data.articleCount) })}</span>
      </div>

      <section className="metric-strip" aria-label="Obsidian 知识库实时指标">
        {metrics.map((metric) => (
          <div className="metric-cell" key={metric.label}>
            <span className="metric-label">{metric.label}</span>
            <strong className={metric.purple ? "metric-value metric-value--purple" : "metric-value"}>
              {numberFormatter.format(metric.value)}
            </strong>
            <span className="metric-caption">{metric.caption}</span>
          </div>
        ))}
      </section>

      <div className="dashboard-grid">
        <KnowledgePreview
          nodeCount={data.articleCount}
          linkCount={data.linkCount}
          preview={data.graphPreview}
          t={t}
        />

        <div className="dashboard-side-stack">
          <section className="panel pipeline-panel">
            <div className="panel-heading">
              <div>
                <p className="micro-label">NEW ARRIVALS</p>
                <h2>{t("dash_activity")}</h2>
                <p className="panel-sub">{t("dash_activity_c")}</p>
              </div>
              <Link href="/dashboard/library" className="tag">{t("dash_library_tag")}</Link>
            </div>
            <div className="pipeline-list">
              {data.fresh.map((item, index) => (
                <ActivityItem item={item} key={item.id} latest={index === 0} formatDate={formatDate} />
              ))}
            </div>
          </section>

          <section className="panel health-panel">
            <div className="panel-heading">
              <div>
                <p className="micro-label">VAULT STATUS</p>
                <h2>{t("dash_health")}</h2>
              </div>
              <Sparkles aria-hidden="true" />
            </div>
            <div className="health-list">
              <HealthRow label={t("health_30d")} value={data.updatedThisMonth} color="green" formatNumber={(v) => numberFormatter.format(v)} />
              <HealthRow label={t("health_linked")} value={data.linkedArticleCount} color="purple" formatNumber={(v) => numberFormatter.format(v)} />
              <HealthRow label={t("health_annotated")} value={data.annotatedArticleCount} color="muted" formatNumber={(v) => numberFormatter.format(v)} />
            </div>
          </section>
        </div>
      </div>

      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <p className="micro-label">RECENT EDITS</p>
            <h2>{t("dash_recent")}</h2>
            <p className="panel-sub">{t("dash_recent_c")}</p>
          </div>
          <Link href="/dashboard/library" className="button button-secondary">
            {t("view_all")} <ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
        <div>
          {data.recent.slice(0, 4).map((item, index) => (
            <Link className="list-row recent-row" href={`/reading/${item.id}`} key={item.id}>
              <span className={index === 0 ? "recent-dot recent-dot--active" : "recent-dot"} />
              <FileText aria-hidden="true" />
              <strong>{item.title}</strong>
              <span>{item.folder}</span>
              <time>{formatDate(item.updatedAt)}</time>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActivityItem({
  item,
  latest,
  formatDate,
}: {
  item: DashboardActivity;
  latest: boolean;
  formatDate: (value: string | Date) => string;
}) {
  return (
    <Link className="pipeline-item" href={`/reading/${item.id}`}>
      {latest ? <Clock3 aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
      <div>
        <strong>{item.title}</strong>
        <span>{item.folder} · {formatDate(item.updatedAt)}</span>
      </div>
      <ArrowUpRight className="pipeline-item-arrow" aria-hidden="true" />
    </Link>
  );
}

function HealthRow({
  label,
  value,
  color,
  formatNumber,
}: {
  label: string;
  value: number;
  color: string;
  formatNumber: (value: number) => string;
}) {
  return (
    <div className="health-row">
      <span className={`health-indicator health-indicator--${color}`} />
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}
