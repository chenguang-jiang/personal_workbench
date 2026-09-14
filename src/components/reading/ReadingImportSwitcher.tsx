"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { WorkspacePulse } from "@/components/dashboard/WorkspacePulse";

const IMPORT_VISIBLE_DURATION = 30_000;

export function ReadingImportSwitcher() {
  const [importVisible, setImportVisible] = useState(false);
  const returnTimerRef = useRef<number | null>(null);

  const revealImport = useCallback(() => {
    setImportVisible(true);
  }, []);

  useEffect(() => {
    if (!importVisible) return;
    returnTimerRef.current = window.setTimeout(() => {
      setImportVisible(false);
      returnTimerRef.current = null;
    }, IMPORT_VISIBLE_DURATION);

    return () => {
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
    };
  }, [importVisible]);

  return (
    <div
      className={importVisible ? "reading-import-switcher reading-import-switcher--import-visible" : "reading-import-switcher"}
      data-return-delay={IMPORT_VISIBLE_DURATION}
    >
      <div className="reading-import-switcher__eyes">
        <WorkspacePulse compact onBlinkComplete={revealImport} />
      </div>
      <Link
        href="/reading/new"
        className="button button-purple reading-import-switcher__button"
        aria-hidden={!importVisible}
        tabIndex={importVisible ? 0 : -1}
      >
        <Plus aria-hidden="true" /> 导入文章
      </Link>
      <span className="sr-only" aria-live="polite">
        {importVisible ? "导入文章按钮已显示，将在三十秒后收起" : "AI 索引眼睛已显示"}
      </span>
    </div>
  );
}
