import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const UPSTREAM = "https://aihot.virxact.com/hot";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface HotItem {
  rank: number;
  title: string;
  url: string;
  status?: string;
  source?: string;
  time?: string;
  heat?: number;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** 解析 aihot /hot 页面的 TOP 10 榜单行 */
export function parseHotHtml(html: string): HotItem[] {
  const items: HotItem[] = [];
  const rowRe = /<li class="hot-rank-row">([\s\S]*?)<\/li>/g;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html))) {
    const block = match[1];
    const link = block.match(/<a class="hot-rank-link" href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!link) continue;
    const title = decodeEntities(link[2].replace(/<[^>]+>/g, "").trim());
    if (!title) continue;
    const href = link[1];
    const metaBlock = block.match(/<div class="hot-rank-meta">([\s\S]*?)<\/div>/)?.[1];
    const metaSpans = metaBlock
      ? [...metaBlock.matchAll(/<span[^>]*>([^<]*)<\/span>/g)]
          .map((span) => span[1].trim())
          .filter(Boolean)
      : [];
    items.push({
      rank: Number(block.match(/hot-rank-number[^>]*>\s*(\d+)/)?.[1] ?? items.length + 1),
      title,
      url: href.startsWith("http") ? href : `https://aihot.virxact.com${href}`,
      status: block.match(/hot-status[^>]*>([^<]+)/)?.[1]?.trim() || undefined,
      source: metaSpans[0] || undefined,
      time: metaSpans.length > 1 ? metaSpans[metaSpans.length - 1] : undefined,
      heat: Number(block.match(/hot-rank-sources-count">\s*(\d+)/)?.[1] ?? 0) || undefined,
    });
    if (items.length >= 10) break;
  }
  return items;
}

async function fetchUpstream(): Promise<HotItem[]> {
  const response = await fetch(UPSTREAM, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`aihot 上游 ${response.status}`);
  const items = parseHotHtml(await response.text());
  if (items.length === 0) throw new Error("aihot 页面结构解析失败");
  return items;
}

function localDayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// GET /api/hot?refresh=1 — 当日 AI 热点 TOP 10（每日缓存，refresh 强制重抓）
export async function GET(req: NextRequest) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const dayKey = localDayKey();

  try {
    if (!refresh) {
      const cached = await prisma.dailyHot.findUnique({ where: { id: dayKey } });
      if (cached) {
        const items = cached.items as unknown as HotItem[];
        if (Array.isArray(items) && items.length > 0) {
          return NextResponse.json({
            date: dayKey,
            fetchedAt: cached.fetchedAt,
            items,
            cached: true,
          });
        }
      }
    }

    const items = await fetchUpstream();
    const fetchedAt = new Date();
    await prisma.dailyHot.upsert({
      where: { id: dayKey },
      create: { id: dayKey, items: items as never, fetchedAt },
      update: { items: items as never, fetchedAt },
    });
    return NextResponse.json({ date: dayKey, fetchedAt, items, cached: false });
  } catch (error) {
    // 上游失败时退回当日旧缓存（如有），否则报错
    const cached = await prisma.dailyHot.findUnique({ where: { id: dayKey } }).catch(() => null);
    if (cached) {
      return NextResponse.json({
        date: dayKey,
        fetchedAt: cached.fetchedAt,
        items: cached.items,
        cached: true,
        warning: error instanceof Error ? error.message : "上游抓取失败",
      });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "热点抓取失败" },
      { status: 502 },
    );
  }
}
