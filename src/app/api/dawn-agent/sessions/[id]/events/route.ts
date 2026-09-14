import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { dawnAgentRuntime } from "@/lib/dawn-agent-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await prisma.dawnAgentSession.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!session) {
    return Response.json({ error: "会话不存在" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let revision = 0;
      let polling = false;
      let lastSignature = "";
      const send = (event: string, payload: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(
            `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
          ),
        );
      };
      const unsubscribe = dawnAgentRuntime.onSessionChange(id, () => {
        revision += 1;
        send("refresh", { revision, at: Date.now() });
      });
      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          const snapshot = await prisma.dawnAgentSession.findUnique({
            where: { id },
            select: {
              status: true,
              updatedAt: true,
              events: {
                orderBy: { sequence: "desc" },
                take: 1,
                select: { sequence: true },
              },
              approvals: {
                orderBy: { updatedAt: "desc" },
                take: 1,
                select: { id: true, status: true, updatedAt: true },
              },
            },
          });
          if (!snapshot) {
            send("deleted", { at: Date.now() });
            finish();
            return;
          }
          const approval = snapshot.approvals[0];
          const signature = [
            snapshot.status,
            snapshot.updatedAt.toISOString(),
            snapshot.events[0]?.sequence ?? -1,
            approval?.id ?? "",
            approval?.status ?? "",
            approval?.updatedAt.toISOString() ?? "",
          ].join(":");
          if (lastSignature && signature !== lastSignature) {
            revision += 1;
            send("refresh", { revision, at: Date.now() });
          }
          lastSignature = signature;
        } catch {
          send("degraded", { at: Date.now() });
        } finally {
          polling = false;
        }
      };
      const poller = setInterval(() => void poll(), 650);
      const heartbeat = setInterval(
        () => send("heartbeat", { at: Date.now() }),
        10_000,
      );
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(poller);
        clearInterval(heartbeat);
        unsubscribe();
        req.signal.removeEventListener("abort", finish);
        try {
          controller.close();
        } catch {
          // The browser may already have cancelled the stream.
        }
      };
      stop = finish;
      req.signal.addEventListener("abort", finish, { once: true });
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      send("refresh", { revision, at: Date.now() });
      void poll();
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
