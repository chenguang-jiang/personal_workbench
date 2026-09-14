export type DawnHandoffInput = {
  sourceType: "reading-selection" | "reading-document" | "knowledge" | "reasoning";
  sourceTitle: string;
  sourcePath?: string;
  sourceRef?: string;
  selectedText?: string;
  context?: string;
  instruction?: string;
  metadata?: Record<string, unknown>;
};

export async function createDawnHandoff(input: DawnHandoffInput) {
  const response = await fetch("/api/dawn-agent/handoffs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "无法把上下文交给 Dawn Agent");
  return data as { id: string };
}
