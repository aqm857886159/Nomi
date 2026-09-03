// R16 核心愿景验证：外部 agent 经 MCP 驱动 Nomi 产出**真素材**（「AI 出初稿」的机制端到端）。
// 起真 MCP stdio 服务（app 二进制+NOMI_MCP_STDIO=1），像 Claude Code 那样发 JSON-RPC：
//   读模型 → 建项目 → 加镜头节点 → nomi_generate 真生成一张图（headless 走 elicitation 确认付费）
//   → 读画布验证节点真拿到图素材。
// **会花一次真图额度**（测试默认授权）。额度闸：不显式 NOMI_R16_GEN=1 就 SKIP。
// 用法：pnpm run build && NOMI_R16_GEN=1 node tests/ux/mcp-draft-loop.e2e.mjs
//
// ⚠️ 已知缺口（2026-09-02 面收敛名迁移时如实记录，未修）：生成一步仍调 nomi_generate——它在 M1 期已整体
// 退役（-32602），42→15 收敛映射里没有等价名（单次生成 = nomi_operation_plan→preview→gate→execute 语义族）。
// 付费腿在重构前会在该步红；本文件其余步骤已迁到收敛名。
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { launchNomiApp } from "./_launchApp.mjs";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const spendFlag = "--spend-real-credit";

// Keep the documented env gate, but restart the harness once without it. On macOS the dev Electron
// process can SIGABRT when its Node parent originally inherited this test-only authorization flag.
if (process.env.NOMI_R16_GEN && !process.argv.includes(spendFlag)) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.NOMI_R16_GEN;
  const rerun = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), spendFlag], {
    cwd: repoRoot,
    env: cleanEnv,
    stdio: "inherit",
  });
  process.exit(rerun.status ?? 1);
}

if (!process.argv.includes(spendFlag)) {
  console.log("SKIP mcp-draft-loop.e2e: 会花一次真图额度。NOMI_R16_GEN=1 node tests/ux/mcp-draft-loop.e2e.mjs 才跑。");
  process.exit(0);
}

// 隔离 settings（避开用户运行中的实例）+ 拷真 catalog 拿已连模型/key（safeStorage 同机可解）+ 临时项目。
const realSettings = process.env.NOMI_SETTINGS_DIR || path.join(os.homedir(), "Library/Application Support/Nomi");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "nomi-draft-"));
const userDataDir = tempRoot;
const settingsDir = tempRoot;
const projectsDir = path.join(tempRoot, "projects");
const shotsDir = path.join(repoRoot, "tests/ux/shots/mcp-quick-draft");
mkdirSync(projectsDir, { recursive: true });
mkdirSync(shotsDir, { recursive: true });
const realCatalog = path.join(realSettings, "model-catalog.json");
if (!existsSync(realCatalog)) { console.log(`SKIP: 找不到真 model-catalog.json（${realCatalog}）。`); process.exit(0); }

const appPathArg = process.argv.find((value) => value.startsWith("--app-path="));
const appBundle = String(process.env.NOMI_APP_PATH || appPathArg?.slice("--app-path=".length) || "").trim();
delete process.env.NOMI_APP_PATH;
const packagedExecutable = appBundle
  ? path.join(appBundle, "Contents", "MacOS", "Nomi")
  : "";
const packagedLauncher = appBundle
  ? path.join(appBundle, "Contents", "Frameworks", "Nomi Helper.app", "Contents", "MacOS", "Nomi Helper")
  : "";
const packagedLauncherScript = appBundle
  ? path.join(appBundle, "Contents", "Resources", "app.asar", "dist-electron", "capabilityCore", "mcpNodeLauncher.js")
  : "";
let gui = null;
let catalogInjected = false;
copyFileSync(realCatalog, path.join(settingsDir, "model-catalog.json"));
writeFileSync(path.join(settingsDir, "project-location.json"), JSON.stringify({ projectsRoot: projectsDir }), "utf8");
catalogInjected = true;
gui = await launchNomiApp({
  name: "mcp-quick-draft",
  ...(appBundle ? { executablePath: packagedExecutable } : {}),
  userDataDir,
  settingsDir,
  projectsDir,
  env: { NOMI_CAPABILITY_DIR: path.join(tempRoot, "capability-core") },
});

let passed = 0;
function assert(cond, label) { if (!cond) { console.log(`  ✗ ${label}`); throw new Error(`FAIL: ${label}`); } passed += 1; console.log(`  ✓ ${label}`); }

const devLauncherScript = path.join(repoRoot, "dist-electron", "capabilityCore", "mcpNodeLauncher.js");
const child = spawn(appBundle ? packagedLauncher : require("electron"), [appBundle ? packagedLauncherScript : devLauncherScript], {
  cwd: repoRoot,
  // NOMI_CAPABILITY_DIR 隔离能力核 lockfile（否则探到用户运行中的真 app → A 模式转发，不走 headless 生成）。
  env: {
    ...process.env,
    ...{
      ELECTRON_RUN_AS_NODE: "1",
      NOMI_MCP_APP_COMMAND: appBundle ? packagedExecutable : require("electron"),
      NOMI_MCP_APP_ARGS: JSON.stringify(appBundle ? [] : [repoRoot]),
    },
    NOMI_MCP_STDIO: "1",
    NOMI_SETTINGS_DIR: settingsDir,
    NOMI_ELECTRON_USER_DATA_DIR: userDataDir,
    NOMI_CAPABILITY_DIR: path.join(tempRoot, "capability-core"),
  },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderrTail = "";
let childExit = null;
child.stderr.on("data", (chunk) => {
  const text = String(chunk);
  stderrTail = `${stderrTail}${text}`.slice(-4_000);
  process.stderr.write(text);
});
child.on("exit", (code, signal) => {
  childExit = { code, signal };
});

const pending = new Map();
let seq = 0;
const rl = readline.createInterface({ input: child.stdout });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t.startsWith("{")) return;
  let msg; try { msg = JSON.parse(t); } catch { return; }
  // 服务端→客户端请求：付费确认 elicitation/create → 自动 accept（测试授权花额度）。
  if (msg.method === "elicitation/create" && msg.id != null) {
    console.log("  · 收到付费确认 elicitation → accept");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { action: "accept", content: { confirm: true } } }) + "\n");
    return;
  }
  if (msg.id != null && pending.has(msg.id)) { const { resolve, timer } = pending.get(msg.id); clearTimeout(timer); pending.delete(msg.id); resolve(msg); }
});

function rpc(method, params, timeoutMs = 30000) {
  const id = (seq += 1);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC 超时: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
// tools/call 的结果被 JSON.stringify 进 text content——解出来。
async function callToolRaw(name, args, timeoutMs = 30000) {
  const response = await rpc("tools/call", { name, arguments: args }, timeoutMs);
  if (response?.error) throw new Error(`工具 ${name} 失败：${response.error.message || JSON.stringify(response.error)}`);
  const res = response.result;
  if (res?.isError) throw new Error(`工具 ${name} 失败：${res?.content?.[0]?.text || ""}`);
  return res;
}
async function callTool(name, args, timeoutMs = 30000) {
  const res = await callToolRaw(name, args, timeoutMs);
  const text = res?.content?.[0]?.text || "";
  try { return JSON.parse(text); } catch {
    const jsonStart = text.indexOf("\n{");
    if (jsonStart >= 0) {
      try { return JSON.parse(text.slice(jsonStart + 1)); } catch { /* human-readable fallback below */ }
    }
    return text;
  }
}

try {
  // 起服务（initialize 声明支持 elicitation，否则付费无法确认）。
  let init = null;
  for (let i = 0; i < 20 && !init; i++) {
    try {
      init = await rpc("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: { elicitation: {} },
        clientInfo: { name: "OpenAI Codex", version: "e2e" },
      }, 4000);
    } catch {
      if (childExit) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const exitFailure = childExit ? `进程退出 code=${childExit.code} signal=${childExit.signal}` : "";
  const initFailure = init?.error?.message || stderrTail.trim().slice(-800) || exitFailure || "无响应";
  assert(init?.result, init?.result ? "MCP stdio 服务起来了" : `MCP stdio 启动失败：${initFailure}`);

  // 先完成 Electron/MCP 首启，再注入真实模型配置与隔离项目位置。外部 guard 与用户目录都不进入子进程。
  if (!catalogInjected) {
    copyFileSync(realCatalog, path.join(settingsDir, "model-catalog.json"));
    writeFileSync(path.join(settingsDir, "project-location.json"), JSON.stringify({ projectsRoot: projectsDir }), "utf8");
    catalogInjected = true;
  }

  // 面收敛：模型清单 = nomi_read(target=models)；条目在 structuredContent.nomiOutcome.models（text 是人话转述）。
  const models = await callToolRaw("nomi_read", { target: "models" });
  const list = models?.structuredContent?.nomiOutcome?.models || [];
  // 避开已知死模型（apimart Imagen 上游 404 必死，见记忆 batch-generation-audit），优先已知可用族。
  const imgAll = list.filter((m) => (m.kind === "image" || m.intent === "image") && (m.enabled ?? true) && !/imagen/i.test(m.modelKey || ""));
  const img = imgAll.find((m) => /z-image|qwen-image|gpt-image|seedream|flux|nano-banana/i.test(m.modelKey || "")) || imgAll[0];
  assert(img, `找到已连图片模型（${img ? (img.vendor || img.vendorKey) + "·" + img.modelKey : "无"}）`);

  const proj = await callTool("nomi_project_create", { name: "R16 MCP 出初稿验证" });
  const projectId = proj.projectId || proj.id;
  assert(projectId, `建项目成功（${projectId}）`);

  const addNodes = callTool("nomi_canvas_edit", { projectId, action: "add_nodes", nodes: [
    { kind: "image", title: "角色参考", prompt: "橘猫，琥珀色眼睛，红色细项圈。" },
    { kind: "shot", title: "S1 面馆开场", prompt: "橘猫蹲在深夜面馆的木桌上，暖黄灯光，浅景深。" },
    { kind: "shot", title: "S2 老板递碗", prompt: "面馆老板把一碗热汤面推到橘猫面前，蒸汽上升。" },
  ] }, 70_000);
  if (gui) {
    const planDialog = gui.win.locator("div.fixed.inset-0").filter({ hasText: /在画布落一套方案|落到画布/ }).first();
    await planDialog.waitFor({ timeout: 15_000 });
    await planDialog.locator("button").last().click();
    console.log("  · 已在真实 Nomi 中确认三节点方案落画布");
  }
  const added = await addNodes;
  const nodeIds = added.nodeIds || added.ids || [];
  assert(nodeIds.length === 3, `一次加好 3 个可编辑节点（${nodeIds.join(", ")}）`);
  const [referenceNodeId, firstShotNodeId] = nodeIds;

  const connected = await callTool("nomi_canvas_edit", {
    projectId,
    action: "connect",
    connections: [{ source: referenceNodeId, target: firstShotNodeId, mode: "reference" }],
  });
  assert(connected?.created === 1 || connected?.edgeIds?.length === 1 || connected?.ok === true, "角色参考已连到首镜");

  console.log("  · 触发真生成（图片）——等生成完成…");
  const generation = callTool("nomi_generate", { projectId, vendor: img.vendor || img.vendorKey, modelKey: img.modelKey, intent: "image", prompt: "一只琥珀眼、戴红色细项圈的橘猫蹲在深夜面馆木桌上，暖黄灯光，浅景深。", nodeId: firstShotNodeId }, 180000);
  let gen;
  if (gui) {
    const spendDialog = gui.win.locator("div.fixed.inset-0").filter({ hasText: /开始生成|会消耗模型额度|将生成/ }).first();
    const first = await Promise.race([
      generation.then((value) => ({ kind: "result", value }), (error) => ({ kind: "error", error })),
      spendDialog.waitFor({ timeout: 15_000 }).then(() => ({ kind: "dialog" })),
    ]);
    if (first.kind === "error") throw first.error;
    if (first.kind === "dialog") {
      await spendDialog.locator("button").last().click();
      console.log("  · 已在真实 Nomi 中确认本次模型额度");
      gen = await generation;
    } else {
      gen = first.value;
    }
  }
  gen ??= await generation;
  console.log(`  · 生成返回：${JSON.stringify(gen).slice(0, 160)}`);

  assert(gen?.status === "succeeded", `生成成功（status=${gen?.status}）`);
  // 生成结果在 gen.assets[0].url；也兜底读画布节点。
  const resultUrl = gen?.assets?.[0]?.url || gen?.result?.url || gen?.url;
  assert(resultUrl && /^(https?:|asset:|nomi-local:|file:)/.test(String(resultUrl)), `节点真拿到图素材（${String(resultUrl).slice(0, 56)}）`);
  const canvas = await callTool("nomi_read", { target: "canvas", projectId });
  assert(Array.isArray(canvas.nodes) && canvas.nodes.length === 3, `画布回读到 3 个节点`);
  assert(Array.isArray(canvas.edges) && canvas.edges.length === 1, "画布回读到 1 条 reference 连线");

  // 关闭无窗 MCP 进程，再用同一构建、同一隔离项目库启动真实 Nomi，确认用户实际看到完整结果。
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (!gui) {
    gui = await launchNomiApp({
      name: "mcp-quick-draft",
      userDataDir,
      settingsDir,
      projectsDir,
      env: { NOMI_CAPABILITY_DIR: path.join(tempRoot, "gui-capability") },
    });
  }
  await gui.win.setViewportSize({ width: 1440, height: 900 });
  await gui.win.evaluate(() => {
    for (const key of ["nomi:splash:v1", "nomi:journey-tour:v1", "nomi:canvas-gesture-hint:v1"]) {
      window.localStorage.setItem(key, "seen");
    }
    window.localStorage.setItem("nomi:locale:v1", "zh-CN");
    window.localStorage.setItem("nomi-color-scheme", "light");
  });
  await gui.win.reload();
  await gui.win.locator('[data-project-card="true"]').first().click();
  await gui.win.waitForFunction(() => window.location.hash.includes("projectId="), undefined, { timeout: 10_000 });
  await gui.win.locator(".generation-canvas-v2-node").first().waitFor({ timeout: 10_000 });
  assert(await gui.win.locator(".generation-canvas-v2-node").count() === 3, "真实 Nomi 画布显示 3 个节点");
  assert(await gui.win.locator(".generation-canvas-v2__edge").count() === 1, "真实 Nomi 画布显示 reference 连线");
  assert(await gui.win.locator(`[data-node-id="${firstShotNodeId}"] img`).count() > 0, "首镜在真实画布上显示生成结果");
  const screenshot = path.join(shotsDir, "quick-draft-complete.png");
  await gui.win.screenshot({ path: screenshot });
  await gui.close();
  gui = null;

  console.log(`\nMCP-DRAFT-LOOP PASS: ${passed} 断言——3 节点 + reference + 真生成已在真实 Nomi 画布闭环。`);
  console.log(`  Screenshot: ${screenshot}`);
  process.exit(0);
} catch (err) {
  console.log(`✗ ${err?.message || err}`);
  child.kill("SIGTERM");
  await gui?.close().catch(() => undefined);
  setTimeout(() => process.exit(1), 300);
}
