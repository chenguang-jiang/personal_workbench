"use client";

import { useCallback, useEffect, useState, ViewTransition } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Search,
  StickyNote,
  Trash2,
} from "lucide-react";
import { ReadingImportSwitcher } from "@/components/reading/ReadingImportSwitcher";
import { DeleteDocumentDialog } from "@/components/reading/DeleteDocumentDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatDate } from "@/lib/utils";
import { useUiPrefs } from "@/lib/ui-prefs";

interface Article {
  id: string;
  title: string;
  url?: string | null;
  tags: string[];
  updatedAt: string;
  readingProgress: number;
  _count: { highlights: number; notes: number };
}

interface ArticlePage {
  items: Article[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  current: Article | null;
}

const PAGE_SIZE = 12;

// 模块级快照：从阅读器返回时同步渲染卡片，保证 view-transition 一镜到底
type LibrarySnapshot = {
  articles: Article[];
  current: Article | null;
  search: string;
  page: number;
  pageCount: number;
  total: number;
};

let librarySnapshot: LibrarySnapshot | null = null;

export default function ReadingListPage() {
  const { t } = useUiPrefs();
  const [articles, setArticles] = useState<Article[]>(
    librarySnapshot?.articles ?? [],
  );
  const [current, setCurrent] = useState<Article | null>(
    librarySnapshot?.current ?? null,
  );
  const [search, setSearch] = useState(librarySnapshot?.search ?? "");
  const [page, setPage] = useState(librarySnapshot?.page ?? 1);
  const [pageCount, setPageCount] = useState(librarySnapshot?.pageCount ?? 1);
  const [total, setTotal] = useState(librarySnapshot?.total ?? 0);
  const [loading, setLoading] = useState(!librarySnapshot);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Article | null>(null);

  // 带 ?search= 落地（如阅读器链接解析失败的兕底）时预填搜索
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const param = new URLSearchParams(window.location.search)
        .get("search")
        ?.trim();
      if (param) setSearch(param);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const loadArticles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        paginate: "true",
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (search) params.set("search", search);
      const response = await fetch(`/api/articles?${params}`);
      if (!response.ok) throw new Error("articles-failed");
      const result: ArticlePage = await response.json();
      setArticles(result.items);
      setCurrent(result.current);
      setPageCount(result.pageCount);
      setTotal(result.total);
      librarySnapshot = {
        articles: result.items,
        current: result.current,
        search,
        page,
        pageCount: result.pageCount,
        total: result.total,
      };
    } catch {
      setError("书架没有加载成功，请检查数据库连接后重试。");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const timer = window.setTimeout(loadArticles, 160);
    return () => window.clearTimeout(timer);
  }, [loadArticles]);

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  // 删除成功：本地乐观移除卡片并同步模块快照，避免返回列表时闪现已删文档
  function handleDeleted(id: string) {
    setPendingDelete(null);
    setArticles((previous) => previous.filter((article) => article.id !== id));
    setTotal((previous) => Math.max(0, previous - 1));
    setCurrent((previous) => (previous?.id === id ? null : previous));
    if (librarySnapshot) {
      librarySnapshot.articles = librarySnapshot.articles.filter(
        (article) => article.id !== id,
      );
      librarySnapshot.total = Math.max(0, librarySnapshot.total - 1);
      if (librarySnapshot.current?.id === id) librarySnapshot.current = null;
    }
  }

  return (
    <ViewTransition
      enter={{
        "document-open": "document-forward",
        "nav-back": "document-back",
        default: "none",
      }}
      exit={{
        "document-open": "document-forward",
        "nav-back": "document-back",
        default: "none",
      }}
      default="none"
    >
      <div className="page-frame reading-page-frame">
        <PageHeader
          eyebrow="READING LIBRARY · { MARKDOWN }"
          title={t("reading_title")}
          description={t("reading_desc")}
          actions={<ReadingImportSwitcher />}
          alignActionsWithTitle
        />

        <div className="reading-toolbar">
          <label>
            <Search aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => updateSearch(event.target.value)}
              placeholder="搜索文章、主题或正文…"
            />
          </label>
          <div className="reading-count">
            <strong>{total}</strong>
            <span>BOOKS</span>
          </div>
        </div>

        {loading && !current ? (
          <div className="skeleton current-reading-skeleton" />
        ) : error ? (
          <div className="empty-state panel">
            <BookOpen aria-hidden="true" />
            <strong>书架暂时不可用</strong>
            <span>{error}</span>
            <button
              type="button"
              className="button button-primary"
              onClick={loadArticles}
            >
              重新加载
            </button>
          </div>
        ) : current && !search ? (
          <section className="current-reading panel">
            <BookCover article={current} featured />
            <div className="current-reading-copy">
              <p className="micro-label">
                {current.readingProgress > 0
                  ? "CURRENTLY READING"
                  : "READY TO READ"}
              </p>
              <h2>{current.title}</h2>
              <p>
                {current.readingProgress > 0
                  ? `上次读到 ${Math.round(current.readingProgress)}%`
                  : "尚未开始"}{" "}
                · {current._count.highlights} 个标注 · {current._count.notes}{" "}
                条笔记
              </p>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.max(current.readingProgress, 8)}%` }}
                />
              </div>
            </div>
            <Link
              href={`/reading/${current.id}`}
              transitionTypes={["document-open"]}
              className="button button-purple"
            >
              {current.readingProgress > 0 ? "继续上次位置" : "开始阅读"}{" "}
              <ArrowRight aria-hidden="true" />
            </Link>
          </section>
        ) : null}

        <section className="reading-library-section">
          <div className="section-heading reading-library-heading">
            <div>
              <p className="micro-label">IN YOUR LIBRARY</p>
              <h2>
                {search ? t("read_results", { q: search }) : t("read_all")}
              </h2>
            </div>
            <span>
              {total
                ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} / ${total}`
                : "0 / 0"}
            </span>
          </div>

          {loading && articles.length === 0 ? (
            <div className="book-grid">
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <div className="skeleton book-card-skeleton" key={item} />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="empty-state panel">
              <BookOpen aria-hidden="true" />
              <strong>{search ? "没有匹配的文章" : "书架还是空的"}</strong>
              <span>
                {search
                  ? "换一个标题或正文关键词继续搜索。"
                  : "导入一篇文章，从第一处高亮开始建立知识库。"}
              </span>
              {!search && (
                <Link href="/reading/new" className="button button-purple">
                  导入第一篇
                </Link>
              )}
            </div>
          ) : (
            <div className="book-grid">
              {articles.map((article, index) => (
                <ViewTransition
                  name={`document-${article.id}`}
                  share="document-morph"
                  default="none"
                  key={article.id}
                >
                  <div className="book-card-shell">
                    <Link
                      href={`/reading/${article.id}`}
                      transitionTypes={["document-open"]}
                      className="book-card"
                    >
                      <BookCover
                        article={article}
                        issue={(page - 1) * PAGE_SIZE + index + 1}
                      />
                      <div className="book-card-copy">
                        <time>{formatDate(article.updatedAt)}</time>
                        <h3>{article.title}</h3>
                        <div className="article-meta">
                          <span>
                            <Highlighter aria-hidden="true" />{" "}
                            {article._count.highlights} 标注
                          </span>
                          <span>
                            <StickyNote aria-hidden="true" />{" "}
                            {article._count.notes} 笔记
                          </span>
                        </div>
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{ width: `${article.readingProgress}%` }}
                          />
                        </div>
                      </div>
                      <ArrowRight
                        className="book-card-arrow"
                        aria-hidden="true"
                      />
                    </Link>
                    <button
                      type="button"
                      className="book-card-delete"
                      title={`删除《${article.title}》`}
                      aria-label={`删除《${article.title}》`}
                      onClick={(event) => {
                        event.preventDefault();
                        setPendingDelete(article);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </ViewTransition>
              ))}
            </div>
          )}

          {pageCount > 1 && (
            <nav className="reading-pagination" aria-label="书架分页">
              <button
                type="button"
                className="button button-secondary"
                disabled={page <= 1 || loading}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft aria-hidden="true" /> 上一页
              </button>
              <span>
                <strong>{page}</strong> / {pageCount}
              </span>
              <button
                type="button"
                className="button button-secondary"
                disabled={page >= pageCount || loading}
                onClick={() =>
                  setPage((value) => Math.min(pageCount, value + 1))
                }
              >
                下一页 <ChevronRight aria-hidden="true" />
              </button>
            </nav>
          )}
        </section>

        {pendingDelete && (
          <DeleteDocumentDialog
            doc={{
              id: pendingDelete.id,
              title: pendingDelete.title,
              url: pendingDelete.url,
            }}
            onDeleted={handleDeleted}
            onClose={() => setPendingDelete(null)}
          />
        )}
      </div>
    </ViewTransition>
  );
}

function BookCover({
  article,
  featured = false,
  issue = 1,
}: {
  article: Article;
  featured?: boolean;
  issue?: number;
}) {
  const tone = coverTone(article.title);
  return (
    <div
      className={`${featured ? "book-cover book-cover--featured" : "library-book-cover"} book-cover--tone-${tone}`}
      aria-hidden="true"
    >
      <span>{article.tags[0] || "KNOWLEDGE"}</span>
      <strong>{article.title}</strong>
      <small>W / {String(issue).padStart(3, "0")}</small>
    </div>
  );
}

function coverTone(title: string): number {
  return (
    Array.from(title).reduce(
      (sum, character) => sum + (character.codePointAt(0) || 0),
      0,
    ) % 4
  );
}
