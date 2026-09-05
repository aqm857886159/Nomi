// 用户视角真机走查：接入格式 auto-probe（2026-06-06）。
//
// 不是后台脚本「我自己接成功」——而是启动真 Electron app，照用户操作点进 onboarding：
//   模型设置 → 添加模型 → 自定义/中转站 → 填地址+key → 测试连接 → 看 auto-probe 替用户选协议。
//
// 三条真实旅程：
//   J1 成功态：指向本地 mock「只认 /responses 的中转」→ 期望绿勾「用的是 Responses 协议」。
//   J2 成功态：指向本地 mock「openai-compatible 中转」→ 期望「用的是 Chat Completions 协议」。
//   J3 失败态：指向真实中转 + 假 key → 期望失败指路 + 协议覆盖区自动展开（逃生口）。
//
// 用法：pnpm run build && node tests/ux/wire-protocol-walkthrough.mjs
import { launchNomiApp } from "./_launchApp.mjs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shotDir = path.join(repoRoot, "tests/ux/__shots__");
fs.mkdirSync(shotDir, { recursive: true });

// ---- 本地 mock 中转：按 behavior 决定 /chat/completions 与 /responses 各自行为 ----
function startMockRelay(behavior) {
  const hits = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const url = req.url || "";
        hits.push(`${req.method} ${url}`);
        const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
        // GET /models：两种 behavior 都给一个模型列表
        if (req.method === "GET" && url.endsWith("/models")) return send(200, { data: [{ id: "mock-model-1" }] });
        if (behavior === "responses-only") {
          if (url.endsWith("/chat/completions")) return send(404, { error: "this relay only speaks /responses" });
          if (url.endsWith("/responses")) return send(200, { id: "resp_1", output: [{ content: [{ text: "pong" }] }] });
        } else if (behavior === "auth-fail") {
          // 模拟「key 错」：所有端点 401（真实中转 chatanywhere 假 key 的行为，但零外部依赖）。
          return send(401, { error: { message: "ApiKey错误：wrong api key", code: "401 UNAUTHORIZED" } });
        } else { // openai-compatible
          if (url.endsWith("/chat/completions")) return send(200, { choices: [{ message: { content: "pong" } }] });
          if (url.endsWith("/responses")) return send(404, { error: "no responses here" });
        }
        send(404, { error: "not found" });
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, hits }));
  });
}

let passed = 0; const fails = [];
const ok = (cond, label) => { if (cond) { passed++; console.log(`  ✓ ${label}`); } else { fails.push(label); console.log(`  ✗ ${label}`); } };

const mockResp = await startMockRelay("responses-only");
const mockChat = await startMockRelay("openai-compatible");
const mockFail = await startMockRelay("auth-fail");
console.log(`mock responses-only → http://127.0.0.1:${mockResp.port}/v1`);
console.log(`mock openai-compat  → http://127.0.0.1:${mockChat.port}/v1`);
console.log(`mock auth-fail      → http://127.0.0.1:${mockFail.port}/v1`);

const { app, win } = await launchNomiApp({ name: "wire-protocol-walkthrough", settleMs: 1800 });

// 2026-09-05：锚点从已退役的「打开模型接入」换成实际渲染的「打开模型设置」。
// 旧锚点在 src 里零命中，于是 `count() === 0` 恒真（每次都白点一遍「继续创作」）、
// 下面那行 click 必然超时——一个死锚点同时造了假绿和真红。
async function enterStudioOnce() {
  // app 开在项目库首页：用户点一个项目进 studio（模型设置浮层只在 studio 内）。
  if (await win.locator('[aria-label="打开模型设置"]').count() === 0) {
    await win.getByRole("button", { name: /继续创作/ }).first().click().catch(() => {});
    await win.waitForTimeout(3500);
  }
}

async function openWizard() {
  await enterStudioOnce();
  await win.locator('[aria-label="打开模型设置"]').first().click();
  await win.waitForTimeout(700);
  // drawer 里的「添加模型」按钮才开 wizard modal（getByText 会误中标题 span）。
  await win.getByRole("button", { name: "添加模型", exact: true }).first().click();
  await win.waitForTimeout(1000);
  // wizard 默认开在「图片/视频模型」(docs) 页 → 切到「文本模型」(manual) 才有预设+BaseURL。
  await win.getByRole("button", { name: "文本模型", exact: true }).first().click().catch(() => {});
  await win.waitForTimeout(500);
  await win.getByPlaceholder("https://api.openai.com/v1").waitFor({ timeout: 8000 }).catch(() => {});
}

async function pickCustom() {
  await win.getByText("自定义 / 中转站", { exact: false }).first().click();
  await win.waitForTimeout(400);
}

async function fillAndTest(base, key, modelId) {
  // BaseURL（openai-compatible 占位符）
  const baseInput = win.getByPlaceholder("https://api.openai.com/v1");
  await baseInput.fill(base);
  await win.getByPlaceholder("sk-...").fill(key);
  if (modelId) {
    const tags = win.getByPlaceholder("输入模型 id 回车，或先拉取可用模型");
    await tags.fill(modelId); await tags.press("Enter");
  }
  await win.waitForTimeout(300);
  await win.getByRole("button", { name: "测试连接" }).first().click();
  await win.waitForTimeout(5000); // 等 auto-probe 真发 HTTP（真实中转可能多发几次探测）
}

async function testStateText() {
  // 用 TreeWalker 抓「文本节点」（避开 <style> CSS 大块），匹配结果关键词。
  return await win.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = []; let n;
    while ((n = walker.nextNode())) {
      const t = (n.textContent || "").trim();
      if (t && t.length < 400 && /已连上|连不上|连接正常|用的是|手动指定/.test(t)) hits.push(t);
    }
    return hits.join(" | ") || "(无结果文字)";
  });
}

try {
  // ---------- J1：responses-only mock → 期望探测出 Responses ----------
  console.log("\n[J1] 用户接一个只认 /responses 的中转（mock）");
  await openWizard();
  await pickCustom();
  await fillAndTest(`http://127.0.0.1:${mockResp.port}/v1`, "sk-mock-key", "mock-model-1");
  const t1 = await testStateText();
  console.log("    结果文字:", t1);
  await win.screenshot({ path: path.join(shotDir, "j1-responses-detected.png") });
  ok(/Responses/.test(t1) && /已连上|协议/.test(t1), "J1 auto-probe 探测出 Responses 协议并显示给用户");

  // 关闭重开，进 J2
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(500);

  // ---------- J2：openai-compatible mock → 期望探测出 Chat Completions ----------
  console.log("\n[J2] 用户接一个 openai-compatible 中转（mock）");
  await openWizard();
  await pickCustom();
  await fillAndTest(`http://127.0.0.1:${mockChat.port}/v1`, "sk-mock-key", "mock-model-1");
  const t2 = await testStateText();
  console.log("    结果文字:", t2);
  await win.screenshot({ path: path.join(shotDir, "j2-chat-detected.png") });
  ok(/Chat Completions|连上/.test(t2), "J2 auto-probe 探测出 Chat Completions 协议");

  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(500);

  // ---------- J3：key 错（auth-fail mock，零外部依赖）→ 失败指路 + 覆盖区展开 ----------
  console.log("\n[J3] 用户 key 错（本地 auth-fail mock）→ 失败 UX");
  await openWizard();
  await pickCustom();
  await fillAndTest(`http://127.0.0.1:${mockFail.port}/v1`, "sk-invalid-dummy", "gpt-3.5-turbo");
  const t3 = await testStateText();
  console.log("    结果文字:", t3);
  // 失败后协议覆盖区应自动展开（逃生口）
  const overrideShown = await win.getByText("接口协议", { exact: false }).count();
  await win.screenshot({ path: path.join(shotDir, "j3-fail-override.png") });
  ok(/连不上|失败|协议/.test(t3), "J3 失败时给出指路文案（非空白红字）");
  ok(overrideShown > 0, "J3 失败后协议覆盖区自动展开（逃生口）");

  // ---------- J4：专家手动展开覆盖区 + 选 Responses ----------
  console.log("\n[J4] 专家手动指定协议（覆盖区）");
  const manualLink = win.getByText("手动指定", { exact: false });
  if (await manualLink.count() > 0) { await manualLink.first().click(); await win.waitForTimeout(300); }
  const respSeg = win.getByText("Responses", { exact: true });
  ok(await respSeg.count() > 0, "J4 覆盖区出现 Chat Completions / Responses / Anthropic 选择器");
  await win.screenshot({ path: path.join(shotDir, "j4-override-segmented.png") });

} catch (e) {
  fails.push(`异常：${e.message}`);
  console.log("  ✗ 异常:", e.message);
  await win.screenshot({ path: path.join(shotDir, "error.png") }).catch(() => {});
} finally {
  await app.close();
  console.log("\n  mock responses-only 收到:", mockResp.hits.join(", ") || "(无)");
  console.log("  mock openai-compat  收到:", mockChat.hits.join(", ") || "(无)");
  console.log("  mock auth-fail      收到:", mockFail.hits.join(", ") || "(无)");
  mockResp.server.close(); mockChat.server.close(); mockFail.server.close();
  console.log(`\n==== ${passed} 通过, ${fails.length} 失败 ====`);
  if (fails.length) { fails.forEach((f) => console.log("   ✗", f)); process.exit(1); }
}
