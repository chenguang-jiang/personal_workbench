import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 Tailwind 类名 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 格式化日期 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** 格式化数字（万、亿） */
export function formatNumber(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return n.toString();
}

/** 平台名称映射 */
export const PLATFORM_NAMES: Record<string, string> = {
  bilibili: "B站",
  douyin: "抖音",
  weixin: "公众号",
  xiaohongshu: "小红书",
};

/** 平台颜色映射 */
export const PLATFORM_COLORS: Record<string, string> = {
  bilibili: "#00a1d6",
  douyin: "#161823",
  weixin: "#07c160",
  xiaohongshu: "#ff2442",
};

/** 类型颜色映射（知识图谱/素材库） */
export const TYPE_COLORS: Record<string, string> = {
  article: "var(--color-accent-blue)",
  note: "var(--color-accent-green)",
  concept: "var(--color-accent-amber)",
  material: "var(--color-accent-purple)",
};

/** 类型图标映射 */
export const TYPE_ICONS: Record<string, string> = {
  article: "📄",
  note: "📝",
  concept: "💡",
  material: "📎",
};
