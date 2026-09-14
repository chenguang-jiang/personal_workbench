"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";

const HARNESS_URL = "http://127.0.0.1:3080";

export default function DawnHarnessPage() {
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
  const [frameKey, setFrameKey] = useState(0);
  const [frameLoaded, setFrameLoaded] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/dawn-harness/status", { cache: "no-store" });
      const data = await response.json();
      setStatus(data.online ? "online" : "offline");
    } catch {
      setStatus("offline");
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/dawn-harness/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (active) setStatus(data.online ? "online" : "offline");
      })
      .catch(() => {
        if (active) setStatus("offline");
      });
    return () => {
      active = false;
    };
  }, []);

  const recheck = useCallback(() => {
    setStatus("checking");
    setFrameLoaded(false);
    setFrameKey((k) => k + 1);
    void checkStatus();
  }, [checkStatus]);

  const online = status === "online";

  return (
    <div className="harness-full">
      {status === "checking" && (
        <div className="harness-placeholder">
          <Loader2 className="harness-placeholder-icon loader-spin" aria-hidden="true" />
          <p>正在检查本地 harness 服务…</p>
        </div>
      )}
      {status === "offline" && (
        <div className="harness-placeholder">
          <WifiOff className="harness-placeholder-icon" aria-hidden="true" />
          <p>无法连接 127.0.0.1:3080</p>
          <small>请先启动本地 DeepSeek harness 服务，然后重新检测。</small>
          <button type="button" className="command-button" onClick={recheck}>
            <RefreshCw aria-hidden="true" />
            重新检测
          </button>
        </div>
      )}
      {online && (
        <>
          {!frameLoaded && (
            <div className="harness-placeholder">
              <Loader2 className="harness-placeholder-icon loader-spin" aria-hidden="true" />
              <p>正在载入 harness…</p>
            </div>
          )}
          <iframe
            key={frameKey}
            className="harness-frame"
            src={HARNESS_URL}
            title="DeepSeek Harness"
            onLoad={() => setFrameLoaded(true)}
            allow="clipboard-read; clipboard-write"
          />
        </>
      )}
    </div>
  );
}
