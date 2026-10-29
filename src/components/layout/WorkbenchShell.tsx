"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

export function WorkbenchShell({ children, cloud }: { children: React.ReactNode; cloud: boolean }) {
  const pathname = usePathname();
  // 登录页与免登录分享页不套工作台外壳（分享页由 /s/[token] 自带骨架）
  if (pathname === "/login" || pathname.startsWith("/s/")) {
    return <main id="main-content">{children}</main>;
  }
  return (
    <div className="app-shell" data-cloud-readonly={cloud || undefined}>
      <Sidebar cloud={cloud} />
      <main className="app-main" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
