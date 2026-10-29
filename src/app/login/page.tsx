"use client";

import { useState, type FormEvent } from "react";
import { DawnLogo } from "@/components/brand/DawnLogo";
import styles from "./page.module.css";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error || "暂时无法登录，请重试");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      // 仅接受本站路径，防止登录后的开放重定向。
      const target = new URL(next || "/reading", window.location.origin);
      window.location.assign(target.origin === window.location.origin ? target.pathname + target.search + target.hash : "/reading");
    } catch {
      setError("连接失败，请检查网络后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}><DawnLogo /></div>
        <p className={styles.eyebrow}>DAWNKB · PERSONAL LIBRARY</p>
        <h1>晨光知识库</h1>
        <p className={styles.intro}>让积累的知识，随时可读。</p>
        <form onSubmit={login}>
          <label htmlFor="password">访问密码</label>
          <input id="password" type="password" autoComplete="current-password" required maxLength={1024}
            value={password} onChange={(event) => setPassword(event.target.value)}
            aria-describedby={error ? "login-error" : undefined} autoFocus />
          <p id="login-error" role="alert" className={styles.error}>{error}</p>
          <button type="submit" disabled={pending}>{pending ? "正在登录…" : "进入知识库"}<span aria-hidden="true">↗</span></button>
        </form>
        <p className={styles.footer}>私人知识空间 · DeepSeek 智能归档</p>
      </div>
    </section>
  );
}
