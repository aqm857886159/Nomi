// L1 评测 runner 的执行环境(D5-A 拍板):真 Electron 实例 + 三重隔离
// (projects/settings/chromium),终态取证读落盘 project.json(不信 agent 自述),
// 轨迹读 .nomi/events(S0 地基)。复用 tests/ux 驱动的感知→操作模式。
//
// 安全铁律(评审后端#7):自动批准必须过工具白名单;白名单外一律拒绝;
// eval:score 兜底断言 zeroVendorCalls(评测环境绝不烧生成额度)。
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** 今天全部 5 个画布工具都免额度;将来出现 costy 工具(如 run_generation_batch)默认就被拒。 */
export const TOOL_WHITELIST = new Set([
  "read_canvas_state",
  "create_canvas_nodes",
  "connect_canvas_edges",
  "set_node_prompt",
  "delete_canvas_nodes",
]);

export function realCatalogPath() {
  return path.join(os.homedir(), "Library", "Application Support", "Nomi", "model-catalog.json");
}

/** 建一套全新隔离环境;requireCatalog=true 时拷入真实 catalog(safeStorage 加密 key 同机可解)。 */
export function prepareIsolation(isoDir, { requireCatalog = true } = {}) {
  fs.rmSync(isoDir, { recursive: true, force: true });
  for (const d of ["settings", "projects", "chromium"]) fs.mkdirSync(path.join(isoDir, d), { recursive: true });
  const catalog = realCatalogPath();
  if (requireCatalog && !fs.existsSync(catalog)) {
    throw new Error(`真实 model-catalog.json 不存在(${catalog})——被测 agent 需要已配置的模型与 key`);
  }
  if (fs.existsSync(catalog)) fs.copyFileSync(catalog, path.join(isoDir, "settings", "model-catalog.json"));
  return {
    projectsDir: path.join(isoDir, "projects"),
    settingsDir: path.join(isoDir, "settings"),
    chromiumDir: path.join(isoDir, "chromium"),
  };
}

export async function launchIsolatedApp(repoRoot, iso) {
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [".", `--user-data-dir=${iso.chromiumDir}`],
    cwd: repoRoot,
    env: { ...process.env, NOMI_PROJECTS_DIR: iso.projectsDir, NOMI_SETTINGS_DIR: iso.settingsDir },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(1500);
  return { app, win };
}

/** 起始页 → 新建空白项目 → 等项目目录落盘,返回 projectDir。 */
export async function createBlankProject(win, projectsDir) {
  await win.getByText("新建空白项目", { exact: false }).first().click({ timeout: 10_000 });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const dirs = fs.existsSync(projectsDir)
      ? fs.readdirSync(projectsDir).filter((name) => fs.existsSync(path.join(projectsDir, name, ".nomi", "project.json")))
      : [];
    if (dirs.length === 1) return path.join(projectsDir, dirs[0]);
    if (dirs.length > 1) throw new Error("隔离区出现多个项目——隔离被污染");
    await win.waitForTimeout(300);
  }
  throw new Error("新建项目超时:项目目录未落盘");
}

/** 打开生成区 AI 面板(若未开),返回输入框 locator 已可用。 */
export async function openGenerationAiPanel(win) {
  const input = win.locator('[aria-label="给生成助手发送消息"]');
  if (await input.count()) return;
  // 空白项目默认落「创作」标签,生成 AI 面板在「生成」工作区——先切过去
  // (旧版直接点「Nomi 生成」文字在创作标签下找不到 → 整批评测 infra 超时)。
  await win.getByRole("button", { name: "生成", exact: true }).first().click({ timeout: 5000 }).catch(() => {});
  await win.waitForTimeout(800);
  if (await input.count()) return;
  // 点「生成区 AI 启动器」开侧栏
  const launcher = win.locator('[aria-label="生成区 AI 启动器"]');
  if (await launcher.count()) await launcher.first().click({ timeout: 5000 });
  else await win.getByText("Nomi 生成", { exact: false }).first().click({ timeout: 5000 });
  await input.first().waitFor({ state: "visible", timeout: 5000 });
}

/** 指定本次评测用的助手模型(写 localStorage 偏好,与用户在面板里手选等价)。 */
export async function setAssistantModelPref(win, pref) {
  await win.evaluate((value) => {
    localStorage.setItem("nomi.assistantModel", JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("nomi:assistant-model-changed"));
  }, pref);
}

export async function readAssistantModelLabel(win) {
  try {
    return (await win.locator('[aria-label="助手模型"]').first().textContent({ timeout: 2000 }))?.trim() || "";
  } catch {
    return "";
  }
}

export async function sendAgentMessage(win, message) {
  await win.locator('[aria-label="给生成助手发送消息"]').first().fill(message, { timeout: 5000 });
  await win.locator('[aria-label="生成 AI 发送"]').first().click({ timeout: 5000 });
}

export function readEventsLog(projectDir) {
  const dir = path.join(projectDir, ".nomi", "events");
  if (!fs.existsSync(dir)) return [];
  const events = [];
  for (const file of fs.readdirSync(dir).filter((f) => /^log-\d+\.jsonl$/.test(f)).sort()) {
    for (const line of fs.readFileSync(path.join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        /* 撕裂尾行 */
      }
    }
  }
  return events;
}

export function readProjectPayload(projectDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, ".nomi", "project.json"), "utf8"));
  } catch {
    return null;
  }
}

/** 最新一个未决工具提议(proposed 但无 approved/rejected/completed 对应)。 */
function pendingProposal(events) {
  const resolved = new Set();
  const proposed = [];
  for (const e of events) {
    const id = e.payload?.toolCallId;
    if (!id) continue;
    if (e.type === "agent.tool.proposed") proposed.push({ toolCallId: id, toolName: String(e.payload?.toolName || "") });
    if (e.type === "agent.tool.completed" || e.type === "agent.proposal.approved" || e.type === "agent.proposal.rejected") resolved.add(id);
  }
  return proposed.filter((p) => !resolved.has(p.toolCallId)).at(-1) || null;
}

/**
 * 批准循环:轮询事件日志,turn 收尾即返回;出现确认卡时——白名单内点「确认」,
 * 白名单外点「拒绝」(并记账)。事件日志是判断真相源,UI 只是操作对象。
 */
/** 终态轮事件(收尾/出错)计数——多轮评测发消息前先数一次,作 baselineTurnCount。 */
export function countFinishedTurns(events) {
  return events.filter((e) => e.type === "agent.turn.finished" || e.type === "agent.turn.error").length;
}

/**
 * 「基线之后新出现的」收尾事件;还没有 → null。多轮评测的命门:不被上一轮残留的
 * turn.finished 命中(否则第二条消息一发就瞬间假收尾,表现为 0 工具/0 文本的假阴性)。
 */
export function newFinishedTurn(events, baselineTurnCount = 0) {
  const terminal = events.filter((e) => e.type === "agent.turn.finished" || e.type === "agent.turn.error");
  return terminal.length > baselineTurnCount ? terminal[terminal.length - 1] : null;
}

export async function approveUntilTurnEnds(win, projectDir, { timeoutMs = 180_000, log = () => {}, baselineTurnCount = 0 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const result = { finished: false, status: "timeout", approvals: 0, denials: 0, deniedTools: [] };
  while (Date.now() < deadline) {
    const events = readEventsLog(projectDir);
    // 多轮安全:只认基线之后的新收尾事件;单轮默认 baselineTurnCount=0,行为不变。
    const last = newFinishedTurn(events, baselineTurnCount);
    if (last) {
      result.finished = last.type === "agent.turn.finished";
      result.status = last.type === "agent.turn.finished" ? String(last.payload?.status || "ok") : "error";
      result.errorMessage = last.type === "agent.turn.error" ? String(last.payload?.message || "") : undefined;
      return result;
    }
    const confirmButtons = win.locator("button", { hasText: /^(确认|全部拒绝)/ });
    const confirmCount = await confirmButtons.count().catch(() => 0);
    if (confirmCount > 0) {
      const pending = pendingProposal(events);
      const toolName = pending?.toolName || "(unknown)";
      if (pending && !TOOL_WHITELIST.has(toolName)) {
        log(`  ⛔ 白名单外工具 ${toolName} → 拒绝`);
        await win.locator("button", { hasText: /拒绝/ }).first().click({ timeout: 3000 }).catch(() => {});
        result.denials += 1;
        result.deniedTools.push(toolName);
      } else {
        const approve = win.locator("button", { hasText: /^确认/ }).first();
        const label = ((await approve.textContent().catch(() => "")) || "").trim();
        await approve.click({ timeout: 3000 }).catch(() => {});
        result.approvals += 1;
        log(`  ✓ 批准: ${toolName} (${label})`);
      }
      await win.waitForTimeout(800);
      continue;
    }
    await win.waitForTimeout(1000);
  }
  return result;
}

/** 等画布终态持久化:轮询 project.json 直到 revision 稳定(连续两次相同)。 */
export async function waitForPersistedCanvas(win, projectDir, { settleMs = 1200, timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastRevision = -1;
  while (Date.now() < deadline) {
    const record = readProjectPayload(projectDir);
    const revision = record?.revision ?? -1;
    if (revision === lastRevision && revision >= 0) return record;
    lastRevision = revision;
    await win.waitForTimeout(settleMs);
  }
  return readProjectPayload(projectDir);
}
