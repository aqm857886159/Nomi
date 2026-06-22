// 运镜旅途级评测 · B 层（agent 选择质量）—— FAITHFUL 版。
//
// 为什么重写：旧版直接 chatV2Start RAW（不带 systemPrompt）在空画布上跑，
// 结构上根本点不出工具——运镜的触发规则住在渲染层 system prompt（generationCanvasAgentClient）
// 与工具自身 schema 描述里，RAW 路径两者皆无，且画布没有可指的视频节点 → 8/8 误判 0 调用。
//
// 这版走「真·应用内 agent 路径」：隔离真 Electron 实例 + 真 catalog（apimart key + deepseek-v4-pro）
// → 新建项目 → 先用一轮 agent 建出一个 kind=video 的镜头节点当靶子（create_canvas_nodes 在
// 白名单内，自动批准、零额度）→ 落盘确认视频节点存在 → 再逐条发运镜请求，经真实 UI 面板
// （openGenerationAiPanel + sendAgentMessage）让 agent 拿到带触发规则的真 system prompt。
//
// 取证 = 读 .nomi/events 里的 agent.tool.proposed 事件（payload.args.move），不信 agent 自述。
// 零额度铁律：create_camera_move 不在 TOOL_WHITELIST，approveUntilTurnEnds 会在「确认卡」出现时
// 自动「拒绝」它——即「捕获 spec 然后拒绝」，host 永不真渲/真生成。仅验工具选择层。
//
// 用法：pnpm run build && APIMART_E2E=1 node tests/ux/camera-move-agent-eval.e2e.mjs
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareIsolation,
  launchIsolatedApp,
  createBlankProject,
  openGenerationAiPanel,
  setAssistantModelPref,
  sendAgentMessage,
  approveUntilTurnEnds,
  countFinishedTurns,
  waitForPersistedCanvas,
  readEventsLog,
  readProjectPayload,
} from "../../evals/lib/isoApp.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

if (!process.env.APIMART_E2E) {
  console.log("SKIP camera-move-agent-eval: 会花文本额度（真 LLM 工具选择）。APIMART_E2E=1 才跑。");
  process.exit(0);
}

const MODEL_PREF = {
  vendorKey: process.env.APIMART_VENDOR || "apimart",
  modelKey: process.env.APIMART_TEXT_MODEL || "deepseek-v4-pro",
};

// 场景三类（kind 字段决定打分口径）：
//   - in-vocab：期望 move ∈ expect 枚举集（精确路）。
//   - out-of-vocab：期望 customMove 非空 且 NOT 硬塞 enum（词表外逃生口）。
//   - static：负样本，不该调用工具。
const SCENARIOS = [
  // 词表内：仍走 enum 精确路。
  { kind: "in-vocab", text: "镜头慢慢推近女主角的脸。", expect: ["push_in"] },
  { kind: "in-vocab", text: "镜头绕着主角转一圈。", expect: ["orbit_left", "orbit_right"] },
  { kind: "in-vocab", text: "镜头从低往高升起来，展现整个战场。", expect: ["crane_up"] },
  { kind: "in-vocab", text: "镜头跟着奔跑的角色向左横移。", expect: ["track_left"] },
  { kind: "in-vocab", text: "镜头缓缓拉远，露出空荡荡的房间。", expect: ["pull_out"] },
  { kind: "in-vocab", text: "镜头快速怼近主角惊恐的眼睛。", expect: ["push_in"] },
  { kind: "in-vocab", text: "镜头从侧面弧线扫过对峙的两人。", expect: ["arc_left", "arc_right"] },
  // 词表外：期望 customMove（不硬塞最近的 enum）。
  // dolly-zoom 最容易被错塞成 push_in —— 显式断言不得是 push_in。
  { kind: "out-of-vocab", text: "镜头来一个希区柯克式的眩晕变焦（dolly zoom）。", forbidMove: ["push_in"] },
  { kind: "out-of-vocab", text: "镜头先推近她的脸，然后猛地甩向窗外。" }, // 复合：不该是单个硬塞 enum
  // 无人机俯冲穿过人群 —— 词表无 drone/dive，应走 customMove（不硬塞 crane/push）。
  // （注：「照搬某段参考视频运镜」是另一种操作=直接挂 video_ref，非 create_camera_move 的活，故不作本工具的用例）
  { kind: "out-of-vocab", text: "镜头像无人机一样俯冲穿过欢呼的人群。" },
  // 负样本：不该调运镜。
  { kind: "static", text: "固定机位，角色站着说话，镜头不动。" },
];

/** 读落盘画布节点（终态真相源，不信 agent 自述）。 */
function readNodes(projectDir) {
  const rec = readProjectPayload(projectDir);
  return rec?.payload?.generationCanvas?.nodes || [];
}

/** 本轮新出现的 create_camera_move 提议（基线之后）→ 它的 args（含 move）；没有则 null。 */
function newCameraMoveArgs(events, baselineProposedCount) {
  const proposals = events.filter(
    (e) => e.type === "agent.tool.proposed" && e.payload?.toolName === "create_camera_move",
  );
  if (proposals.length <= baselineProposedCount) return null;
  return proposals[proposals.length - 1]?.payload?.args ?? {};
}

function countCameraMoveProposals(events) {
  return events.filter(
    (e) => e.type === "agent.tool.proposed" && e.payload?.toolName === "create_camera_move",
  ).length;
}

const isoDir = path.join(os.tmpdir(), "nomi-camera-move-eval");
let app = null;
try {
  // 1) 隔离环境 + 真 catalog（apimart key 同机可解密 + deepseek-v4-pro 可用）。
  const iso = prepareIsolation(isoDir, { requireCatalog: true });
  const launched = await launchIsolatedApp(repoRoot, iso);
  app = launched.app;
  const win = launched.win;

  // 2) 新建空白项目 + 打开真·生成 AI 面板 + 指定助手模型（与用户手选等价）。
  const projectDir = await createBlankProject(win, iso.projectsDir);
  await openGenerationAiPanel(win);
  await setAssistantModelPref(win, MODEL_PREF);

  // 3) 先用一轮 agent 建出一个 kind=video 的镜头节点当运镜靶子（create_canvas_nodes
  //    在白名单内 → 自动批准、零额度；不点生成所以不出网络）。
  console.log("◆ 种子轮：让 agent 在画布上建一个视频镜头节点（运镜靶子）……");
  {
    const baselineTurnCount = countFinishedTurns(readEventsLog(projectDir));
    await sendAgentMessage(
      win,
      "在画布上创建一个视频镜头节点：一个女孩站在窗边的特写镜头（kind=video）。只建节点，先不要生成。",
    );
    const turn = await approveUntilTurnEnds(win, projectDir, {
      log: (m) => console.log(m),
      baselineTurnCount,
    });
    await waitForPersistedCanvas(win, projectDir);
    if (!turn.finished) {
      throw new Error(`种子轮未正常收尾（status=${turn.status} ${turn.errorMessage || ""}）`);
    }
  }

  // 4) 落盘确认视频节点存在（没有就没法测运镜——直接判 infra 失败）。
  const videoNodes = readNodes(projectDir).filter((n) => n.kind === "video");
  if (videoNodes.length === 0) {
    throw new Error("种子轮后画布上没有 kind=video 节点——无法给运镜提供靶子");
  }
  console.log(`✓ 视频靶子节点已就绪：${videoNodes.map((n) => n.id).join(", ")}\n`);

  // 5) 逐条发运镜请求，走真 UI 面板（拿真 system prompt + 工具自身 schema 触发规则）。
  //    create_camera_move 不在白名单 → approveUntilTurnEnds 自动「拒绝」（捕获后拒，零额度）。
  const rows = [];
  let pass = 0;
  for (const sc of SCENARIOS) {
    const baselineEvents = readEventsLog(projectDir);
    const baselineTurnCount = countFinishedTurns(baselineEvents);
    const baselineCmCount = countCameraMoveProposals(baselineEvents);

    await sendAgentMessage(
      win,
      `画布上已有一个视频镜头节点。请只为它处理「运镜」（如果这个镜头需要运镜就用合适的工具，不需要就什么都别做）：${sc.text}`,
    );
    await approveUntilTurnEnds(win, projectDir, {
      log: () => {}, // 静默：拒绝 create_camera_move 是预期行为，不刷屏
      baselineTurnCount,
    });
    await waitForPersistedCanvas(win, projectDir);

    const args = newCameraMoveArgs(readEventsLog(projectDir), baselineCmCount);
    const called = args !== null;
    const move = called ? (args.move ?? null) : null;
    const customMove = called ? (args.customMove ?? null) : null;

    let ok;
    let expectLabel;
    if (sc.kind === "static") {
      // 负样本：不该调
      ok = !called;
      expectLabel = "不调用";
    } else if (sc.kind === "in-vocab") {
      // 词表内：走 enum 精确路，且不该用 customMove。
      ok = called && move != null && sc.expect.includes(move) && !customMove;
      expectLabel = `move=${sc.expect.join("/")}`;
    } else {
      // 词表外：必须用 customMove（非空），且不得硬塞被禁的 enum。
      const usedCustom = called && typeof customMove === "string" && customMove.trim().length > 0;
      const noForcedMove = !move || (sc.forbidMove ? !sc.forbidMove.includes(move) : true);
      ok = usedCustom && noForcedMove;
      expectLabel = `customMove(非空)${sc.forbidMove ? ` 且 move∉[${sc.forbidMove.join("/")}]` : "、move 留空"}`;
    }
    if (ok) pass += 1;

    const got = !called
      ? "(未调用)"
      : `move=${move ?? "—"} customMove=${customMove ? "「" + String(customMove).slice(0, 24) + "」" : "—"} speed=${args.speed || "auto"}`;
    const row = `${ok ? "✓" : "✗"} 期望[${expectLabel}] 实得 ${got} | ${sc.text}`;
    rows.push(row);
    console.log("  " + row);
  }

  console.log("\n═══ 运镜 agent 选择评测（B 层 · 真应用内路径）═══");
  rows.forEach((r) => console.log(r));
  console.log(`\n通过 ${pass}/${SCENARIOS.length}`);

  // 零额度兜底断言：整条会话不得有任何真实 vendor 生成调用。
  const vendorCalls = readEventsLog(projectDir).filter((e) => e.type === "vendor.call.requested").length;
  if (vendorCalls > 0) {
    console.log(`⚠️ 安全门：检测到 ${vendorCalls} 次 vendor.call.requested（评测不应真生成）`);
  }

  await app.close();
  process.exit(pass === SCENARIOS.length && vendorCalls === 0 ? 0 : 1);
} catch (err) {
  console.log(`✗ ${err?.message || err}`);
  if (app) await app.close().catch(() => undefined);
  process.exit(1);
}
