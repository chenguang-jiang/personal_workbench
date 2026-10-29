"use client"; // 错误边界必须是客户端组件

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";

// 仪表盘段的兜底 UI：数据库/Vault 暂不可用时给出可重试的友好提示，而不是整页 500
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[Dashboard] 渲染失败:", error);
  }, [error]);

  return (
    <div className="page-frame">
      <section className="panel" role="alert">
        <div className="panel-heading">
          <div>
            <p className="micro-label">SOMETHING WENT WRONG</p>
            <h2>工作台暂时无法加载</h2>
            <p>
              可能是数据库或 Obsidian Vault 暂时不可用。请检查 DATABASE_URL / OBSIDIAN_VAULT_PATH 配置后重试。
              {error.digest ? ` 错误编号：${error.digest}` : ""}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="button button-purple" onClick={() => retry()}>
            <RotateCcw aria-hidden="true" /> 重试
          </button>
          <Link href="/settings" className="button button-secondary">
            查看设置
          </Link>
        </div>
      </section>
    </div>
  );
}
