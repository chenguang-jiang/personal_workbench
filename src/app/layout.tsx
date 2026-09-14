import type { Metadata } from "next";
import { cookies } from "next/headers";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { UiPrefsProvider } from "@/lib/ui-prefs";

const VALID_ACCENTS = new Set(["violet", "blue", "teal", "orange", "crimson", "magenta", "amber"]);

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "晨光知识库 · DawnKB",
    template: "%s · DawnKB",
  },
  description: "晨光知识库 DawnKB，把阅读、知识、灵感与内容复盘放进同一张工作台。",
  icons: {
    icon: "/dawnkb-logo.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const store = await cookies();
  const locale = store.get("dawnkb-locale")?.value === "en" ? "en" : "zh";
  const theme = store.get("dawnkb-theme")?.value === "dark" ? "dark" : "light";
  const accentRaw = store.get("dawnkb-accent")?.value ?? "violet";
  const accent = VALID_ACCENTS.has(accentRaw) ? accentRaw : "violet";

  return (
    <html
      lang={locale === "en" ? "en" : "zh-CN"}
      data-accent={accent}
      data-theme={theme}
      className={jetbrainsMono.variable}
    >
      <body>
        <UiPrefsProvider initial={{ locale, accent, theme }}>
          <div className="app-shell">
            <Sidebar />
            <main className="app-main" id="main-content">
              {children}
            </main>
          </div>
        </UiPrefsProvider>
      </body>
    </html>
  );
}
