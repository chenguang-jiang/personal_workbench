"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PenLine } from "lucide-react";
import { WorkspacePulse } from "@/components/dashboard/WorkspacePulse";

const REVEALED_DURATION = 30_000;

const RETURN_ANIM_DURATION = 500;

type ReadingImportSwitcherProps = {
  onCreate: () => void;
};

export function ReadingImportSwitcher({ onCreate }: ReadingImportSwitcherProps) {
  const [revealed, setRevealed] = useState(false);
  const [returned, setReturned] = useState(false);
  const returnTimerRef = useRef<number | null>(null);
  const returnAnimTimerRef = useRef<number | null>(null);

  const revealCreate = useCallback(() => {
    setReturned(false);
    setRevealed(true);
  }, []);

  // 三十秒后自动收起：收回眼睛并播一次「重新睁眼」的弹回动画
  useEffect(() => {
    if (!revealed) return;
    returnTimerRef.current = window.setTimeout(() => {
      setRevealed(false);
      setReturned(true);
      returnTimerRef.current = null;
      returnAnimTimerRef.current = window.setTimeout(() => {
        setReturned(false);
        returnAnimTimerRef.current = null;
      }, RETURN_ANIM_DURATION);
    }, REVEALED_DURATION);

    return () => {
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
      if (returnAnimTimerRef.current) window.clearTimeout(returnAnimTimerRef.current);
    };
  }, [revealed]);

  const className = [
    "reading-import-switcher",
    revealed ? "reading-import-switcher--import-visible" : "",
    returned ? "reading-import-switcher--returned" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={className} data-return-delay={REVEALED_DURATION}>
      <div className="reading-import-switcher__eyes">
        <WorkspacePulse
          compact
          onBlinkComplete={revealCreate}
          actionLabel="点击眨眼，唤出新建文章按钮"
        />
      </div>
      <button
        type="button"
        className="button button-purple reading-import-switcher__button"
        onClick={onCreate}
        aria-hidden={!revealed}
        tabIndex={revealed ? 0 : -1}
      >
        <PenLine aria-hidden="true" /> 新建文章
      </button>
      <span className="sr-only" aria-live="polite">
        {revealed ? "新建文章按钮已显示，将在三十秒后收起" : "点击眼睛可以唤出新建文章按钮"}
      </span>
    </div>
  );
}
