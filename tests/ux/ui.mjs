// 交互式 UI 驱动的客户端：发一条命令给常驻 ui-driver，等结果打印。
// 前提：先后台启动 `node tests/ux/ui-driver.mjs`（Bash run_in_background:true）。
//
// 命令：
//   node tests/ux/ui.mjs snap                 列出当前可点元素(标签/文字/aria/中心坐标)——据此决定点哪
//   node tests/ux/ui.mjs shot [名字]           截图到 tests/ux/shots/<名字>.png（默认 live.png），再用 Read 看
//   node tests/ux/ui.mjs click "添加节点菜单"   按可见文字点；也支持 aria:xx / css:sel / text:xx / xy:120,80
//   node tests/ux/ui.mjs drag x1 y1 x2 y2 [steps]  从(x1,y1)按下→拖到(x2,y2)松手（测拖拽/trim/reorder/scrub）
//   node tests/ux/ui.mjs fill "input[aria-label=模型]" 值
//   node tests/ux/ui.mjs eval "document.title"
//   node tests/ux/ui.mjs wait 800
//   node tests/ux/ui.mjs quit                 关闭 app + 停驱动
import fs from "node:fs";
import path from "node:path";

const DIR = "/tmp/nomi-ui";
const [action, ...rest] = process.argv.slice(2);
if (!action) { console.error("用法: node tests/ux/ui.mjs <snap|shot|click|fill|eval|wait|quit> ..."); process.exit(1); }
if (!fs.existsSync(path.join(DIR, "ready"))) {
  console.error("驱动未就绪。先后台启动: node tests/ux/ui-driver.mjs");
  process.exit(2);
}
const cmd = { action };
if (action === "shot") cmd.name = rest[0];
else if (action === "click") cmd.target = rest.join(" ");
else if (action === "fill") { cmd.sel = rest[0]; cmd.val = rest.slice(1).join(" "); }
else if (action === "setfile") { cmd.sel = rest[0]; cmd.path = rest.slice(1).join(" "); }
else if (action === "eval") cmd.js = rest.join(" ");
else if (action === "drag") { cmd.x1 = Number(rest[0]); cmd.y1 = Number(rest[1]); cmd.x2 = Number(rest[2]); cmd.y2 = Number(rest[3]); cmd.steps = Number(rest[4] || 12); }
else if (action === "wait") cmd.ms = Number(rest[0] || 500);

const resP = path.join(DIR, "res.json");
fs.rmSync(resP, { force: true });
fs.writeFileSync(path.join(DIR, "req.json"), JSON.stringify(cmd));

const t0 = Date.now();
while (!fs.existsSync(resP)) {
  if (Date.now() - t0 > 30000) { console.error("超时：驱动没响应（还在跑吗？）"); process.exit(3); }
  await new Promise((r) => setTimeout(r, 120));
}
await new Promise((r) => setTimeout(r, 60));
console.log(fs.readFileSync(resP, "utf8"));
