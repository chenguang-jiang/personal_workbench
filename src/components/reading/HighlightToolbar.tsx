"use client";

import { useState } from "react";
import { Bot, Database, Highlighter, StickyNote } from "lucide-react";

export interface SelectionPosition {
  x: number;
  y: number;
  text: string;
  context: string;
}

interface HighlightToolbarProps {
  position: SelectionPosition | null;
  onDawnAgent: (text: string, context: string) => void;
  onHighlight: (text: string, color: string) => void;
  onNote: (text: string, context: string) => void;
  onIngest: (text: string, context: string) => void;
}

const HIGHLIGHT_COLORS = [
  { name: "yellow", color: "rgba(250,204,21,0.3)" },
  { name: "green", color: "rgba(52,211,153,0.3)" },
  { name: "blue", color: "rgba(96,165,250,0.3)" },
  { name: "pink", color: "rgba(244,114,182,0.3)" },
];

export function HighlightToolbar({
  position,
  onDawnAgent,
  onHighlight,
  onNote,
  onIngest,
}: HighlightToolbarProps) {
  const [showColors, setShowColors] = useState(false);

  if (!position) return null;

  return (
    <div
      className="selection-toolbar"
      style={{
        left: Math.min(position.x, window.innerWidth - 360),
        top: Math.max(position.y - 50, 10),
      }}
      role="toolbar"
      aria-label="选中文本操作"
    >
      {/* 高亮颜色选择 */}
      {showColors ? (
        <>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.name}
              onClick={() => {
                onHighlight(position.text, c.name);
                setShowColors(false);
              }}
              className="highlight-color"
              style={{ background: c.color }}
              title={c.name}
              aria-label={`使用 ${c.name} 高亮`}
            />
          ))}
          <button
            onClick={() => setShowColors(false)}
            className="selection-cancel"
          >
            ✕
          </button>
        </>
      ) : (
        <>
          <ToolbarButton
            icon={Bot}
            label="Dawn Agent"
            color="var(--color-accent-purple)"
            onClick={() => onDawnAgent(position.text, position.context)}
          />
          <ToolbarButton
            icon={Highlighter}
            label="高亮"
            color="var(--color-accent-amber)"
            onClick={() => setShowColors(true)}
          />
          <ToolbarButton
            icon={StickyNote}
            label="笔记"
            color="var(--color-accent-purple)"
            onClick={() => onNote(position.text, position.context)}
          />
          <ToolbarButton
            icon={Database}
            label="入库"
            color="var(--color-accent-green)"
            onClick={() => onIngest(position.text, position.context)}
          />
        </>
      )}
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  color,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="selection-action"
      style={{ color }}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}
