/** AI 一键整理：方案与条目的共享类型 */

export type OrganizeItemKind = "duplicate" | "useless" | "reclassify";

/** 单条整理建议。delete 走回收站，move 走 relocateObsidianFile */
export type OrganizeItem = {
  id: string;
  kind: OrganizeItemKind;
  action: "delete" | "move";
  articleId: string;
  title: string;
  /** 相对 Vault 根的路径，如 JCG/00-Inbox/foo.md（服务端唯一可信来源） */
  vaultPath: string;
  /** move 时的目标相对路径；delete 时为空 */
  targetPath?: string;
  reason: string;
  /** 0-1；scan 产出的确定性条目为 1 或 0.9+，AI 产出的按模型置信度 */
  confidence: number;
  /** 界面默认是否勾选：高置信度且低风险才默认勾 */
  defaultChecked: boolean;
};

export type OrganizeStats = {
  scanned: number;
  duplicates: number;
  useless: number;
  reclassify: number;
  /** AI 预算之外、本轮未分析的归类候选数量 */
  remaining: number;
};

export type OrganizePlanStatus = "running" | "ready" | "error";

/** 一次整理任务的完整方案（内存单例保存，见 store.ts） */
export type OrganizePlan = {
  id: string;
  status: OrganizePlanStatus;
  /** 已扫描/分析进度，0-100 */
  progress: number;
  items: OrganizeItem[];
  stats: OrganizeStats;
  error?: string;
  createdAt: string;
  appliedAt?: string;
};

/** 应用单条目的结果，逐条回报给界面 */
export type OrganizeApplyResult = {
  id: string;
  ok: boolean;
  error?: string;
};
