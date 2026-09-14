"use client";

import { useEffect, useState } from "react";
import { Bot, Check, Database, HardDrive, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useUiPrefs } from "@/lib/ui-prefs";

interface VaultStatus {
  configured: boolean;
  available: boolean;
  vaultName: string;
  state: "disabled" | "missing" | "starting" | "syncing" | "ready" | "error";
  watching: boolean;
  lastSyncAt: string | null;
  lastEvent: string | null;
  error: string | null;
}

export default function SettingsPage() {
  const { t } = useUiPrefs();
  const [provider, setProvider] = useState("ollama");
  const [ollamaHost, setOllamaHost] = useState("http://localhost:11434");
  const [saved, setSaved] = useState(false);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [syncingVault, setSyncingVault] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedProvider = window.localStorage.getItem("workbench.ai.provider");
      const storedHost = window.localStorage.getItem("workbench.ai.ollamaHost");
      if (storedProvider) setProvider(storedProvider);
      if (storedHost) setOllamaHost(storedHost);
      void fetch("/api/obsidian/sync", { cache: "no-store" })
        .then((response) => response.json())
        .then((status) => setVaultStatus(status))
        .catch(() => setVaultStatus(null));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function syncVault() {
    setSyncingVault(true);
    try {
      const response = await fetch("/api/obsidian/sync", { method: "POST" });
      const result = await response.json();
      if (result.status) setVaultStatus(result.status);
    } finally {
      setSyncingVault(false);
    }
  }

  function savePreferences(event: React.FormEvent) {
    event.preventDefault();
    window.localStorage.setItem("workbench.ai.provider", provider);
    window.localStorage.setItem("workbench.ai.ollamaHost", ollamaHost);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="page-frame">
      <PageHeader
        eyebrow="WORKBENCH SETTINGS"
        title={t("settings_title")}
        description={t("settings_desc")}
      />

      <form className="settings-layout" onSubmit={savePreferences}>
        <section className="panel settings-main">
          <div className="panel-heading"><div><p className="micro-label">AI PROVIDER</p><h2>{t("settings_ai")}</h2></div><Bot aria-hidden="true" /></div>
          <div className="provider-options">
            <button type="button" className={provider === "ollama" ? "provider-option provider-option--active" : "provider-option"} onClick={() => setProvider("ollama")}>
              <span><HardDrive aria-hidden="true" /></span><div><strong>Ollama · 本地模型</strong><p>适合解释、翻译、总结和隐私敏感内容。</p></div>{provider === "ollama" && <Check aria-hidden="true" />}
            </button>
            <button type="button" className={provider === "openai" ? "provider-option provider-option--active" : "provider-option"} onClick={() => setProvider("openai")}>
              <span><Bot aria-hidden="true" /></span><div><strong>OpenAI · 云端模型</strong><p>适合复杂推理、选题生成与跨资料综合。</p></div>{provider === "openai" && <Check aria-hidden="true" />}
            </button>
          </div>

          <div className="settings-fields">
            <label><span>Ollama Host</span><input className="input" value={ollamaHost} onChange={(event) => setOllamaHost(event.target.value)} /></label>
            <label><span>OpenAI API Key</span><input className="input" value="由 OPENAI_API_KEY 提供" disabled /><small>为避免密钥进入浏览器，本项目只从服务端 `.env.local` 读取。</small></label>
          </div>
        </section>

        <aside className="settings-side">
          <section className="panel settings-status">
            <p className="micro-label">SYSTEM</p>
            <h2>{t("settings_system")}</h2>
            <div><Database aria-hidden="true" /><span><strong>PostgreSQL</strong><small>数据库已配置</small></span><i className="status-dot" /></div>
            <div>
              <HardDrive aria-hidden="true" />
              <span>
                <strong>{vaultStatus?.vaultName || "本地 Vault"}</strong>
                <small>{vaultStatusCopy(vaultStatus)}</small>
              </span>
              <i className={`status-dot status-dot--${vaultStatus?.state || "starting"}`} />
            </div>
            <div><ShieldCheck aria-hidden="true" /><span><strong>隐私边界</strong><small>密钥仅服务端可见</small></span><i className="status-dot" /></div>
          </section>
          <button type="button" className="button button-secondary settings-sync" disabled={!vaultStatus?.configured || !vaultStatus.available || syncingVault} onClick={syncVault}>
            <RefreshCw className={syncingVault ? "is-spinning" : undefined} aria-hidden="true" /> {syncingVault ? "正在同步…" : "立即同步 Obsidian"}
          </button>
          <button type="submit" className={saved ? "button button-purple settings-save saved" : "button button-primary settings-save"}>
            {saved ? <Check aria-hidden="true" /> : <Save aria-hidden="true" />} {saved ? "已保存" : "保存偏好"}
          </button>
        </aside>
      </form>
    </div>
  );
}

function vaultStatusCopy(status: VaultStatus | null) {
  if (!status) return "正在读取同步状态";
  if (!status.configured) return "尚未配置 OBSIDIAN_VAULT_PATH";
  if (!status.available) return status.error || "Vault 路径不可用";
  if (status.state === "syncing") return "正在进行差异同步";
  if (status.state === "error") return status.error || "最近一次同步失败";
  if (status.lastEvent) return status.lastEvent;
  return status.watching ? "监听中，保存后约半秒更新" : "已配置，等待监听启动";
}
