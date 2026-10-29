import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { IMPORT_MAX_BYTES } from "./import-plan";

export function isPublicImportAddress(address: string): boolean {
  if (isIP(address) === 6) return /^2[0-9a-f]{3}:/i.test(address) && !address.toLowerCase().startsWith("2001:db8:");
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19)));
}

export function publicImportUrl(raw: string) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new Error("请提供公开网页的 HTTP 或 HTTPS 链接");
  url.hash = "";
  return url;
}

async function readPublicPage(url: URL, deadline: number): Promise<{ status: number; location?: string; text: string; type: string }> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((item) => !isPublicImportAddress(item.address))) throw new Error("仅支持公开互联网网页，不能导入内网地址");
  const pinned = addresses[0];
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("网页读取超时，请粘贴正文导入");
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).get(url, {
      headers: { "User-Agent": "DawnKB/1.0", Accept: "text/html,text/markdown,text/plain", "Accept-Encoding": "identity" },
      // 固定本次已经校验的 DNS 地址，重定向每一跳重新校验，避免 DNS rebinding。
      family: pinned.family,
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (res) => {
      const status = res.statusCode || 500;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume(); resolve({ status, location: res.headers.location, text: "", type: "" }); return;
      }
      if (status !== 200) { res.resume(); reject(new Error("网页暂时无法读取；需要登录的页面请粘贴正文")); return; }
      const type = res.headers["content-type"] || "";
      if (!/text\/(html|plain|markdown)|application\/xhtml\+xml/i.test(type)) { res.resume(); reject(new Error("目前支持网页、Markdown 和文本链接")); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > IMPORT_MAX_BYTES * 2) { req.destroy(new Error("网页过大，请粘贴需要的正文")); return; }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, type, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new Error("网页读取超时，请粘贴正文导入")), Math.min(remaining, 15_000));
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
  });
}

function decode(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (item) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[item] || item)
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => { const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; });
}
export function extractImportedPage(html: string) {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, "").trim() || "");
  const cleaned = html.replace(/<(script|style|nav|footer|header|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const main = cleaned.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1] || cleaned;
  const content = decode(main.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, text: string) => `\n${"#".repeat(Number(n))} ${text}\n`)
    .replace(/<(?:br|\/p|\/div|\/li|\/section|\/tr)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n/g, "\n\n").trim();
  return { title, content };
}

export async function fetchImportLink(raw: string) {
  let url = publicImportUrl(raw);
  const deadline = Date.now() + 30_000;
  for (let hop = 0; hop <= 3; hop++) {
    const result = await readPublicPage(url, deadline);
    if (result.location) { url = publicImportUrl(new URL(result.location, url).toString()); continue; }
    const extracted = /html/i.test(result.type) ? extractImportedPage(result.text) : { title: "", content: result.text.trim() };
    if (extracted.content.length < 80) throw new Error("未能提取足够正文；动态或受限网页请粘贴正文导入");
    const content = `${extracted.content}\n\n来源：${url.toString()}\n`;
    if (Buffer.byteLength(content) > IMPORT_MAX_BYTES) throw new Error("正文超过 1MB，请粘贴需要的部分");
    return { title: extracted.title.slice(0, 120), content };
  }
  throw new Error("网页跳转次数过多，请使用最终链接");
}
