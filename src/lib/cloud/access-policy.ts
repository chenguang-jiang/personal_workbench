// 云端访问规则：写操作默认拒绝，仅允许专用 AI 导入及明确列出的 POST。

export type CloudAccessDecision =
  | { kind: "allow" }
  | { kind: "redirect-login" }
  | { kind: "redirect-home" }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; message: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** 未登录也能访问的路径 */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

/**
 * 未登录也能访问的前缀：公开分享页与分享文章的图片资源（GET-only）。
 * 令牌即凭证：/s/<token> 只暴露对应的一篇文章，资源接口再按正文引用白名单收紧。
 */
const PUBLIC_GET_PREFIXES = ["/s", "/api/share"];

/** 明确允许的 POST：AI 读取、退出登录和受控导入。 */
const READ_ONLY_POST_PATHS = new Set([
  "/api/ai/ask",
  "/api/ai/explain",
  "/api/ai/summarize",
  "/api/ai/translate",
  "/api/resolve",
  "/api/obsidian/sync",
  "/api/auth/logout",
  "/api/knowledge/import",
  "/api/knowledge/ai-import",
  "/api/knowledge/ai-import/attach-images",
  "/api/knowledge/edit",
]);

/**
 * 允许写操作的 API 前缀：头脑风暴（会话管理、消息发送、引用来源定位）、
 * 知识空间管理和题库机（作答、状态、错题本）、AI 一键整理与回收站
 * （只写 Vault 挂载卷和数据库）、素材层文件夹管理。这些功能在云端需要完整
 * 可用——数据写在数据库里，保存的笔记写入已挂载的云端 Vault 卷，不触碰宿主机。
 */
const CLOUD_WRITABLE_API_PREFIXES = [
  "/api/brainstorm",
  "/api/knowledge-spaces",
  "/api/knowledge/reindex",
  "/api/knowledge/organize",
  "/api/knowledge/trash",
  "/api/notes",
  "/api/obsidian/folders",
  "/api/quick-notes",
  "/api/quiz",
];

/**
 * 云端按「方法 + 路径形状」放行的受限写接口，字段级约束由各路由自行校验：
 * 阅读进度（PATCH 仅接受进度字段，正文编辑仍走 /api/knowledge/edit）、
 * 收藏开关（路由只写 favoritedAt）、新建文章（路由只接受标题与文件夹，正文
 * 随后走 /api/knowledge/edit 写回）与删除文章（路由校验 Vault 路径不越界后
 * 级联清理记录）。书架“接着上次读到的地方”依赖第一项。
 */
const CLOUD_LIMITED_WRITE_ROUTES = [
  { method: "PATCH", pattern: /^\/api\/articles\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/articles\/[^/]+\/favorite$/ },
  { method: "POST", pattern: /^\/api\/articles\/[^/]+\/share$/ },
  { method: "POST", pattern: /^\/api\/articles\/new$/ },
  { method: "DELETE", pattern: /^\/api\/articles\/[^/]+$/ },
];

const READ_ONLY_MESSAGE = "请通过「AI 导入」归档或更新云端知识库";

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function decideCloudAccess(
  method: string,
  rawPathname: string,
  session: { isAuthenticated: boolean },
): CloudAccessDecision {
  const pathname = normalize(rawPathname);
  const isApi = isUnder(pathname, "/api");

  if (PUBLIC_PATHS.has(pathname)) return { kind: "allow" };
  // 公开分享：未登录只放行安全方法，写操作仍需登录（且不在任何白名单里，登录也写不了）
  if (
    SAFE_METHODS.has(method.toUpperCase()) &&
    PUBLIC_GET_PREFIXES.some((prefix) => isUnder(pathname, prefix))
  ) {
    return { kind: "allow" };
  }
  if (!session.isAuthenticated) return isApi ? { kind: "unauthorized" } : { kind: "redirect-login" };

  const isWrite = !SAFE_METHODS.has(method.toUpperCase());
  const limitedWrite = CLOUD_LIMITED_WRITE_ROUTES.some(
    (route) => route.method === method.toUpperCase() && route.pattern.test(pathname),
  );
  if (
    isApi &&
    isWrite &&
    !limitedWrite &&
    !READ_ONLY_POST_PATHS.has(pathname) &&
    !CLOUD_WRITABLE_API_PREFIXES.some((prefix) => isUnder(pathname, prefix))
  ) {
    return { kind: "forbidden", message: READ_ONLY_MESSAGE };
  }
  return { kind: "allow" };
}
