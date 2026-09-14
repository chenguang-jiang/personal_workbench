"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  LayoutGrid,
  Library,
  Lightbulb,
  List,
  Paperclip,
  Plus,
  Search,
  StickyNote,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatDate, TYPE_ICONS } from "@/lib/utils";
import { useUiPrefs } from "@/lib/ui-prefs";

interface KnowledgeNode {
  id: string;
  articleId: string | null;
  title: string;
  description: string | null;
  content: string | null;
  type: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface VaultFolder {
  name: string;
  path: string;
  fileCount: number;
  directFileCount: number;
  childFolderCount: number;
}

interface VaultFile {
  name: string;
  path: string;
  title: string;
  description: string;
  tags: string[];
  updatedAt: string;
  articleId: string | null;
}

interface VaultLibrary {
  vaultName: string;
  currentPath: string;
  parentPath: string;
  breadcrumbs: { name: string; path: string }[];
  folders: VaultFolder[];
  files: VaultFile[];
  allFolders: VaultFolder[];
}

const TYPE_FILTERS = [
  { value: "", label: "全部", icon: Library },
  { value: "article", label: "文章", icon: FileText },
  { value: "note", label: "笔记", icon: StickyNote },
  { value: "concept", label: "概念", icon: Lightbulb },
  { value: "material", label: "素材", icon: Paperclip },
];

export default function LibraryPage() {
  const { t } = useUiPrefs();
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [vaultPath, setVaultPath] = useState("JCG");
  const [vault, setVault] = useState<VaultLibrary | null>(null);
  const [vaultLoading, setVaultLoading] = useState(true);
  const [vaultError, setVaultError] = useState("");
  const [page, setPage] = useState(1);
  const indexRef = useRef<HTMLElement | null>(null);

  const PAGE_SIZE = 20;

  // 文件夹类型色：常见目录手工指定，其余按名字哈希取稳定色相
  const FOLDER_HUES: Record<string, number> = {
    "00-首页": 268,
    "00-Inbox": 40,
    个人信息: 340,
    锦浪: 22,
    学习资料: 150,
    AI: 268,
    Clippings: 210,
    Excalidraw: 320,
    Footprints: 180,
  };

  function folderHue(name: string): number {
    const known = FOLDER_HUES[name];
    if (known !== undefined) return known;
    let hash = 5381;
    for (let i = 0; i < name.length; i += 1)
      hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
    return Math.abs(hash) % 360;
  }

  function folderHueStyle(name: string): CSSProperties {
    return { "--folder-hue": String(folderHue(name)) } as CSSProperties;
  }

  const loadNodes = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (typeFilter) params.set("type", typeFilter);
    params.set("sort", sort);
    try {
      const response = await fetch(`/api/knowledge?${params}`);
      setNodes(await response.json());
    } finally {
      setLoading(false);
    }
  }, [search, sort, typeFilter]);

  useEffect(() => {
    const timer = window.setTimeout(loadNodes, 180);
    return () => window.clearTimeout(timer);
  }, [loadNodes]);

  const totalPages = Math.max(1, Math.ceil(nodes.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedNodes = useMemo(
    () => nodes.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [nodes, safePage],
  );

  const goToPage = useCallback((next: number) => {
    setPage(next);
    indexRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadVault() {
      setVaultLoading(true);
      setVaultError("");
      try {
        const response = await fetch(
          `/api/obsidian/library?folder=${encodeURIComponent(vaultPath)}`,
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "无法读取 Obsidian");
        if (!cancelled) setVault(data);
      } catch (error) {
        if (!cancelled)
          setVaultError(
            error instanceof Error ? error.message : "无法读取 Obsidian",
          );
      } finally {
        if (!cancelled) setVaultLoading(false);
      }
    }
    loadVault();
    return () => {
      cancelled = true;
    };
  }, [vaultPath]);

  const visibleVaultFiles = useMemo(() => {
    if (!vault) return [];
    const query = search.trim().toLocaleLowerCase("zh-CN");
    if (!query) return vault.files;
    return vault.files.filter((file) =>
      [file.title, file.description, file.path, ...file.tags].some((value) =>
        value.toLocaleLowerCase("zh-CN").includes(query),
      ),
    );
  }, [search, vault]);

  const visibleVaultFolders = useMemo(
    () => vault?.folders.filter((folder) => folder.fileCount > 0) ?? [],
    [vault],
  );
  const visibleFolderCount = useMemo(
    () =>
      vault?.allFolders.filter(
        (folder) =>
          (folder.path === "JCG" || folder.path.startsWith("JCG/")) &&
          folder.fileCount > 0,
      ).length ?? 0,
    [vault],
  );

  return (
    <div className="page-frame page-frame--wide">
      <PageHeader
        eyebrow="RAW SOURCES · LOCAL VAULT"
        title={t("lib_title")}
        description={t("lib_desc")}
        actions={
          <Link href="/reading/new" className="button button-purple">
            <Plus aria-hidden="true" /> 导入内容
          </Link>
        }
      />

      <div className="library-summary">
        <strong>{nodes.length}</strong>
        <span>FILES</span>
      </div>

      <section className="panel reading-queue">
        <div className="panel-heading">
          <div>
            <p className="micro-label">READING QUEUE</p>
            <h2>{t("lib_queue")}</h2>
          </div>
          <Link href="/reading" className="button button-secondary">
            查看全部 <ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
        <Link
          href={
            nodes[0]?.articleId ? `/reading/${nodes[0].articleId}` : "/reading"
          }
          className="queue-item"
        >
          <span className="queue-icon">
            <FileText aria-hidden="true" />
          </span>
          <div>
            <strong>{nodes[0]?.title ?? "知识库暂无待读内容"}</strong>
            <small>{nodes[0] ? formatDate(nodes[0].updatedAt) : "JCG"}</small>
          </div>
          <span className="tag tag--purple">待看中</span>
        </Link>
      </section>

      <section className="panel folder-browser">
        <div className="panel-heading">
          <div>
            <p className="micro-label">REAL FOLDERS</p>
            <h2>{t("lib_folders")}</h2>
          </div>
          <span className="tag">{visibleFolderCount} non-empty folders</span>
        </div>
        {vault && (
          <nav className="vault-breadcrumbs" aria-label="Obsidian 文件夹路径">
            {vault.currentPath && (
              <button
                type="button"
                onClick={() => setVaultPath(vault.parentPath)}
                aria-label="返回上级文件夹"
              >
                <ChevronLeft aria-hidden="true" />
              </button>
            )}
            {vault.breadcrumbs.map((item, index) => (
              <span key={`${item.path}-crumb`}>
                {index > 0 && <ChevronRight aria-hidden="true" />}
                <button
                  type="button"
                  onClick={() => setVaultPath(item.path)}
                  style={folderHueStyle(item.name)}
                >
                  {item.name}
                </button>
              </span>
            ))}
          </nav>
        )}
        {vaultLoading ? (
          <div className="folder-grid" aria-label="正在读取 Obsidian 文件夹">
            {[1, 2, 3, 4].map((item) => (
              <div className="skeleton vault-folder-skeleton" key={item} />
            ))}
          </div>
        ) : vaultError ? (
          <div className="vault-folder-empty">
            <FolderOpen aria-hidden="true" />
            <strong>暂时无法读取 Vault</strong>
            <span>{vaultError}</span>
          </div>
        ) : vault ? (
          <>
            {visibleVaultFolders.length > 0 ? (
              <div className="folder-grid">
                {visibleVaultFolders.map((folder) => (
                  <button
                    type="button"
                    key={folder.path}
                    onClick={() => setVaultPath(folder.path)}
                    style={folderHueStyle(folder.name)}
                  >
                    <span className="folder-icon">
                      <Folder aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{folder.name}</strong>
                      <small>{folder.path}</small>
                    </span>
                    <span>
                      <strong>{folder.fileCount} 份资料</strong>
                      <small>{folder.childFolderCount} 个子目录</small>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : vault.files.length === 0 ? (
              <div className="vault-folder-empty">
                <FolderOpen aria-hidden="true" />
                <strong>这个文件夹还是空的</strong>
                <span>可以直接在 Obsidian 中添加笔记，DawnKB 会自动同步。</span>
              </div>
            ) : null}

            {vault.files.length > 0 && (
              <div className="vault-file-browser">
                <div className="vault-file-heading">
                  <span>当前文件夹</span>
                  <strong>{visibleVaultFiles.length} files</strong>
                </div>
                <div className="vault-file-list">
                  {visibleVaultFiles.map((file) => {
                    const content = (
                      <>
                        <span className="queue-icon">
                          <FileText aria-hidden="true" />
                        </span>
                        <span>
                          <strong>{file.title}</strong>
                          <small>{file.path}</small>
                        </span>
                        <time>{formatDate(file.updatedAt)}</time>
                        {file.articleId ? (
                          <ArrowUpRight aria-hidden="true" />
                        ) : (
                          <span className="tag">同步中</span>
                        )}
                      </>
                    );
                    return file.articleId ? (
                      <Link
                        className="vault-file-row"
                        href={`/reading/${file.articleId}`}
                        key={file.path}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div
                        className="vault-file-row vault-file-row--disabled"
                        key={file.path}
                      >
                        {content}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : null}
      </section>

      <section className="library-index" ref={indexRef}>
        <div className="library-index-head">
          <div>
            <p className="micro-label">INDEX</p>
            <h2>{t("lib_index")}</h2>
          </div>
          <div className="library-tools">
            <label className="library-search">
              <Search aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="搜索标题、标签或正文…"
              />
            </label>
            <select
              className="select"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
              aria-label="内容排序"
            >
              <option value="recent">最近更新</option>
              <option value="hot">最新创建</option>
              <option value="alpha">字母排序</option>
            </select>
            <div className="view-switch" aria-label="切换内容视图">
              <button
                type="button"
                className={view === "grid" ? "active" : ""}
                onClick={() => setView("grid")}
                aria-label="卡片视图"
              >
                <LayoutGrid />
              </button>
              <button
                type="button"
                className={view === "list" ? "active" : ""}
                onClick={() => setView("list")}
                aria-label="列表视图"
              >
                <List />
              </button>
            </div>
          </div>
        </div>

        <div className="type-tabs">
          {TYPE_FILTERS.map((filter) => {
            const Icon = filter.icon;
            return (
              <button
                type="button"
                key={filter.value}
                className={typeFilter === filter.value ? "active" : ""}
                onClick={() => {
                  setTypeFilter(filter.value);
                  setPage(1);
                }}
              >
                <Icon aria-hidden="true" /> {filter.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div
            className={view === "grid" ? "node-grid" : "node-list"}
            aria-label="正在加载内容"
          >
            {[1, 2, 3, 4, 5, 6].map((item) => (
              <div className="skeleton node-skeleton" key={item} />
            ))}
          </div>
        ) : nodes.length === 0 ? (
          <div className="empty-state panel">
            <Library aria-hidden="true" />
            <strong>当前筛选下没有内容</strong>
            <span>可以换个关键词，或导入第一篇文章。</span>
            <Link href="/reading/new" className="button button-purple">
              导入文章
            </Link>
          </div>
        ) : (
          <div className={view === "grid" ? "node-grid" : "node-list"}>
            {pagedNodes.map((node) => {
              const card = (
                <>
                  <div className="node-card-top">
                    <span className={`node-type node-type--${node.type}`}>
                      {TYPE_ICONS[node.type] || "📎"}
                    </span>
                    <time>{formatDate(node.updatedAt)}</time>
                  </div>
                  <h3>{node.title}</h3>
                  {node.description && <p>{node.description}</p>}
                  <div className="node-card-bottom">
                    <div>
                      {node.tags.slice(0, 3).map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </div>
                    <ArrowUpRight aria-hidden="true" />
                  </div>
                </>
              );
              return node.articleId ? (
                <Link
                  className="node-card"
                  href={`/reading/${node.articleId}`}
                  key={node.id}
                  aria-label={`阅读《${node.title}》`}
                >
                  {card}
                </Link>
              ) : (
                <article
                  className="node-card node-card--disabled"
                  key={node.id}
                >
                  {card}
                </article>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <nav className="library-pagination" aria-label="全部内容分页">
            <button
              type="button"
              className="button button-secondary"
              disabled={safePage <= 1 || loading}
              onClick={() => goToPage(safePage - 1)}
            >
              <ChevronLeft aria-hidden="true" /> 上一页
            </button>
            <span>
              <strong>{safePage}</strong> / {totalPages} · {nodes.length} 篇
            </span>
            <button
              type="button"
              className="button button-secondary"
              disabled={safePage >= totalPages || loading}
              onClick={() => goToPage(safePage + 1)}
            >
              下一页 <ChevronRight aria-hidden="true" />
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}
