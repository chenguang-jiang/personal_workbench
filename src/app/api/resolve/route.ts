import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** POST /api/resolve { targets: string[] } — 批量解析，返回 { map: { target: articleId } } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const targets: string[] = Array.isArray(body.targets) ? body.targets.map((t: unknown) => String(t)).slice(0, 80) : [];
  const map: Record<string, string> = {};
  await Promise.all(
    targets.map(async (target) => {
      const id = await resolveTarget(target);
      if (id) map[target] = id;
    }),
  );
  return NextResponse.json({ map });
}

/** GET /api/resolve?target=xxx — 把 wikilink / vault 路径解析为文章 id */
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("target") ?? "").trim();
  const id = await resolveTarget(raw);
  return NextResponse.json(id ? { id } : { id: null });
}

async function resolveTarget(raw: string): Promise<string | null> {
  if (!raw) return null;
  const noExt = raw.replace(/\.md$/i, "");
  const basename = noExt.split("/").filter(Boolean).pop()?.trim() ?? "";
  if (!basename) return null;

  const candidates = await prisma.article.findMany({
    where: {
      OR: [
        { title: basename },
        { url: { endsWith: `${basename}.md` } },
        { title: { contains: basename } },
        { url: { contains: basename } },
      ],
    },
    select: { id: true, title: true, url: true },
    take: 30,
  });

  const score = (article: { title: string; url: string | null }) => {
    if (article.title === basename) return 0;
    if (article.url?.endsWith(`${basename}.md`)) return 1;
    if (article.title.includes(basename) || basename.includes(article.title)) return 2;
    return 3;
  };
  candidates.sort((a, b) => score(a) - score(b));
  return candidates[0]?.id ?? null;
}
