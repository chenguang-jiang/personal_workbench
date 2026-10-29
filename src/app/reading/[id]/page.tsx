import { Reader } from "@/components/reading/Reader";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { isCloudMode } from "@/lib/cloud/config";

export default async function ReadingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    citationSession?: string | string[];
    citationId?: string | string[];
    messageIndex?: string | string[];
    edit?: string | string[];
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const article = await prisma.article.findUnique({
    where: { id },
    include: {
      highlights: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!article) notFound();

  const citationSession = Array.isArray(query.citationSession)
    ? query.citationSession[0]
    : query.citationSession;
  const citationId = Array.isArray(query.citationId)
    ? query.citationId[0]
    : query.citationId;
  const messageIndexValue = Array.isArray(query.messageIndex)
    ? query.messageIndex[0]
    : query.messageIndex;
  const messageIndex = Number(messageIndexValue ?? "-1");
  let initialCitation: {
    id: string;
    quote: string;
    startOffset: number;
    endOffset: number;
  } | null = null;
  if (citationSession && citationId) {
    const citationSessionRecord = await prisma.brainstormSession.findUnique({
      where: { id: citationSession },
      select: { citations: true },
    });
    const citations = Array.isArray(citationSessionRecord?.citations)
      ? (citationSessionRecord.citations as Array<Record<string, unknown>>)
      : [];
    const citation = citations.find(
      (item) =>
        item.id === citationId &&
        String(item.articleId ?? "") === id &&
        (messageIndex < 0 || Number(item.messageIndex) === messageIndex),
    );
    if (citation && typeof citation.quote === "string") {
      initialCitation = {
        id: String(citation.id),
        quote: citation.quote,
        startOffset: Number(citation.startOffset ?? 0),
        endOffset: Number(citation.endOffset ?? 0),
      };
    }
  }

  // ?edit=1：书架「新建文章」落地即进编辑态
  const initialEditing = query.edit === "1";

  return (
    <Reader
      readOnly={isCloudMode()}
      articleId={id}
      initialEditing={initialEditing}
      initialCitation={initialCitation}
      initialArticle={{
        id: article.id,
        contentVersion: article.contentVersion,
        title: article.title,
        content: article.content || "",
        tags: article.tags,
        source: article.source,
        url: article.url,
        updatedAt: article.updatedAt.toISOString(),
        readingProgress: article.readingProgress,
        favoritedAt: article.favoritedAt?.toISOString() ?? null,
        highlights: article.highlights.map((highlight) => ({
          id: highlight.id,
          text: highlight.text,
          color: highlight.color,
          note: highlight.note,
          prefix: highlight.prefix,
          createdAt: highlight.createdAt.toISOString(),
        })),
        notes: article.notes.map((note) => ({
          id: note.id,
          content: note.content,
          quote: note.quote,
          createdAt: note.createdAt.toISOString(),
        })),
      }}
    />
  );
}
