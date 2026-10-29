// 用 CDP 截阅读器的指定滚动位置：shoot.mjs 的 scroll 只动 window，
// 阅读器是内部滚动容器，这里直接改 scrollTop 再截图。用法：
//   node scripts/reader-shots.mjs <url> <outDir> <scrollTop> [scrollTop...] [--width 1440] [--height 900]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const url = args[0];
const outDir = args[1];
const scrolls = [];
let width = 1440, height = 900;
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--width") width = Number(args[++i]);
  else if (args[i] === "--height") height = Number(args[++i]);
  else scrolls.push(Number(args[i]));
}
mkdirSync(outDir, { recursive: true });

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9333", "--no-first-run",
   `--user-data-dir=/tmp/dawnkb-shots-profile-${Date.now()}`, "--window-size=" + width + "x" + height, "about:blank"],
  { stdio: "ignore" });

async function jsonRpc(path) {
  const res = await fetch(`http://127.0.0.1:9333${path}`);
  return res.json();
}

// 等 CDP 就绪
let targets;
for (let i = 0; i < 40; i++) {
  try { targets = await jsonRpc("/json/list"); if (targets?.some(t => t.type === "page")) break; } catch {}
  await new Promise(r => setTimeout(r, 250));
}
if (!targets?.some(t => t.type === "page")) { console.error("CDP 未就绪"); chrome.kill(); process.exit(1); }
const page = targets.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);

let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise(r => pending.set(id, r));
}
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url });
await new Promise(r => setTimeout(r, 6000)); // 等文章和水合完成

for (const top of scrolls) {
  // smooth 行为会让 scrollTop 赋值变成动画，先临时关掉再瞬时定位
  await send("Runtime.evaluate", { expression: `(() => { const el=document.querySelector('.reader-scroll'); if(!el) return 'no el'; el.style.scrollBehavior='auto'; el.scrollTop=${top}; return el.scrollTop; })()` });
  await new Promise(r => setTimeout(r, 900));
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = join(outDir, `at-${top}.png`);
  writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log("saved", file);
}
ws.close();
chrome.kill();
process.exit(0);
