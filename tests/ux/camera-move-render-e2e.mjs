// 运镜工具「深度端到端」验证 —— 单测照不出的活链路：离屏渲染 → mp4 → 喂 video_ref（免费），
// 再（额度门控）真生成 + #6 mp4 上传到 vendor + VLM 运动核验。
//
// 为什么要它（单测/agent-eval 都覆盖不到的洞）：
//   · camera-move-agent-eval 只验「agent 选不选对工具」——故意拒绝 create_camera_move，host 永不真渲。
//   · 单测（framesToVideoArgs / archetypeMeta / referenceEdgeCapability）只验纯函数与投影规则。
//   · 真正没人验过的是：① 常驻 CameraMoveCaptureHost 在真 WebGL 里沿轨迹采帧 → ffmpeg 真拼出 mp4 →
//     真写回 scene3d.meta.cameraMoveVideo + 真把 mp4 灌进目标视频节点 meta.referenceVideoUrls 并切到
//     有 video_ref 槽的模式（omni）。② 那个 nomi-local:// 的 **mp4** 真生成时会被 apimart 的
//     `POST /v1/uploads/images`（一个「images」端点）上传 —— 这正是 #6 的风险点：图片端点可能拒 mp4。
//
// 两段式：
//   STAGE 1（FREE，APIMART_E2E=1 即跑）：本地 WebGL + ffmpeg，零生成额度。批准 create_camera_move
//     （它的本地渲染不花钱），轮询 host 产物，断言 mp4 产出 + 喂入 video_ref + 切 omni 模式 +
//     全程 vendor.call.requested === 0。
//   STAGE 2（额度门，NOMI_SPEND_OK=1 才跑）：在目标视频节点上批准 run_generation_batch 真生成。
//     这一步 mp4 才被上传到 vendor（#6）。诚实判定：
//       · 上传失败（#6 命中）→ 节点落 status=error，node.error 含上传错误原话（"上传响应缺少可达 URL"
//         / "素材上传失败(HTTP ...)" / multipart 错）；此时 vendor.call.requested 通常 **没有**记录，
//         因为上传在 executeProfileOperation 内、早于 traceVendorRequested（runtime.ts:577 vs 590）→
//         故 #6 只信节点态，不信 vendor 事件。
//       · 上传成功 + 真出片 → node.result.providerUrl/url 落视频 URL；下载 → ffmpeg 抽帧 → VLM 问
//         「这段视频是否呈现了 <请求的运镜，如缓慢推近> 的镜头运动？」打人眼可读裁决。
//
// 铁律：超时绝不冒充成功；每段清晰 PASS/FAIL/SKIP 表头；无 APIMART_E2E 干净跳过。
// 用法：
//   pnpm run build && APIMART_E2E=1 node tests/ux/camera-move-render-e2e.mjs              # 只 STAGE 1（免费）
//   pnpm run build && APIMART_E2E=1 NOMI_SPEND_OK=1 node tests/ux/camera-move-render-e2e.mjs  # 两段全跑（花生成额度）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  prepareIsolation,
  launchIsolatedApp,
  createBlankProject,
  openGenerationAiPanel,
  setAssistantModelPref,
  sendAgentMessage,
  countFinishedTurns,
  newFinishedTurn,
  waitForPersistedCanvas,
  readEventsLog,
  readProjectPayload,
  TOOL_WHITELIST,
} from "../../evals/lib/isoApp.mjs";
import { loadJudgeConfig, postChatJson } from "../../evals/lib/judge.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

if (!process.env.APIMART_E2E) {
  console.log("SKIP camera-move-render-e2e: 需真 catalog + 渲染 + 可能花生成额度。APIMART_E2E=1 才跑。");
  console.log("  STAGE 1（免费渲染+喂入）：APIMART_E2E=1 node tests/ux/camera-move-render-e2e.mjs");
  console.log("  STAGE 2（真生成+#6上传+VLM）：再加 NOMI_SPEND_OK=1");
  process.exit(0);
}

const MODEL_PREF = {
  vendorKey: process.env.APIMART_VENDOR || "apimart",
  modelKey: process.env.APIMART_TEXT_MODEL || "deepseek-v4-pro",
};

// 本次请求的运镜意图（人话 + VLM 核验用的英文短语）。推近 = push_in。
const MOVE_REQUEST = "给这个镜头加一个缓慢推近的运镜。";
const MOVE_HUMAN = "缓慢推近（slow push-in / dolly-in）";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;

/** 读落盘画布节点（终态真相源，不信 agent 自述）。 */
function readNodes(projectDir) {
  const rec = readProjectPayload(projectDir);
  return rec?.payload?.generationCanvas?.nodes || [];
}

function countVendorRequested(projectDir) {
  return readEventsLog(projectDir).filter((e) => e.type === "vendor.call.requested").length;
}

/** 最新一个未决工具提议（proposed 但无 approved/rejected/completed 对应）。 */
function pendingProposal(events) {
  const resolved = new Set();
  const proposed = [];
  for (const e of events) {
    const id = e.payload?.toolCallId;
    if (!id) continue;
    if (e.type === "agent.tool.proposed") proposed.push({ toolCallId: id, toolName: String(e.payload?.toolName || "") });
    if (e.type === "agent.tool.completed" || e.type === "agent.proposal.approved" || e.type === "agent.proposal.rejected")
      resolved.add(id);
  }
  return proposed.filter((p) => !resolved.has(p.toolCallId)).at(-1) || null;
}

/**
 * 本脚本的批准循环 —— 与 isoApp.approveUntilTurnEnds 唯一区别：把 approveSet 里的额外工具也「确认」。
 * STAGE 1 传 approveSet={create_camera_move}（本地渲染零额度，故安全批准）；其余白名单外仍拒绝。
 * STAGE 2 传 approveSet={create_camera_move, run_generation_batch}（run_generation_batch 才真花额度，
 * 仅在 NOMI_SPEND_OK=1 时调用本函数批准它）。事件日志是收尾判据，UI 只是操作面。
 */
async function approveLoop(win, projectDir, { timeoutMs, log = () => {}, baselineTurnCount = 0, approveSet }) {
  const deadline = Date.now() + timeoutMs;
  const result = { finished: false, status: "timeout", approvals: 0, denials: 0, approvedTools: [], deniedTools: [] };
  while (Date.now() < deadline) {
    const events = readEventsLog(projectDir);
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
      const allowed = TOOL_WHITELIST.has(toolName) || approveSet.has(toolName);
      if (pending && !allowed) {
        log(`  ⛔ 未授权工具 ${toolName} → 拒绝`);
        await win.locator("button", { hasText: /拒绝/ }).first().click({ timeout: 3000 }).catch(() => {});
        result.denials += 1;
        result.deniedTools.push(toolName);
      } else {
        const approve = win.locator("button", { hasText: /^确认/ }).first();
        await approve.click({ timeout: 3000 }).catch(() => {});
        result.approvals += 1;
        result.approvedTools.push(toolName);
        log(`  ✓ 批准: ${toolName}`);
      }
      await win.waitForTimeout(800);
      continue;
    }
    await win.waitForTimeout(1000);
  }
  return result;
}

/** 轮询直到 predicate(读盘节点) 为真或超时；返回 { ok, elapsedMs, nodes }。绝不在超时上谎报成功。 */
async function pollNodes(win, projectDir, predicate, { timeoutMs, intervalMs = 1500 }) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    const nodes = readNodes(projectDir);
    if (predicate(nodes)) return { ok: true, elapsedMs: Date.now() - startedAt, nodes };
    await win.waitForTimeout(intervalMs);
  }
  return { ok: false, elapsedMs: Date.now() - startedAt, nodes: readNodes(projectDir) };
}

/** scene3d 节点上 host 写回的运镜小片 url（meta.cameraMoveVideo.url）。 */
function cameraMoveVideoUrl(nodes) {
  for (const n of nodes) {
    const u = n?.meta?.cameraMoveVideo?.url;
    if (typeof u === "string" && u.trim()) return u.trim();
  }
  return null;
}

/** 目标视频节点上被喂入的运镜参考视频数组（meta.referenceVideoUrls）。 */
function referenceVideoUrls(node) {
  const arr = node?.meta?.referenceVideoUrls;
  return Array.isArray(arr) ? arr.filter((u) => typeof u === "string" && u.trim()) : [];
}

/** 节点是否切到了带 video_ref 槽的模式（meta.archetype.modeId === 'omni'，Seedance 全能参考）。 */
function isOmniMode(node) {
  return node?.meta?.archetype?.modeId === "omni";
}

/** ffmpeg 抽样最多 N 帧（每 ~1s 一帧），返回 base64 PNG dataURL 数组；失败返回 []。 */
function sampleVideoFrames(file, frames = 6) {
  if (!hasFfmpeg) return [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-cammove-frames-"));
  try {
    const r = spawnSync(
      "ffmpeg",
      ["-i", file, "-vf", "fps=1", "-frames:v", String(frames), "-y", path.join(tmp, "f_%02d.png")],
      { encoding: "utf8" },
    );
    if (r.status !== 0) return [];
    return fs
      .readdirSync(tmp)
      .filter((f) => f.endsWith(".png"))
      .sort()
      .map((f) => `data:image/png;base64,${fs.readFileSync(path.join(tmp, f)).toString("base64")}`);
  } catch {
    return [];
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** 把生成产物 URL 落成本地文件（providerUrl=https 直下；nomi-local:// 在项目 assets 里反查）。 */
async function materializeOutputVideo(url, projectDir) {
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载产物失败 HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const out = path.join(os.tmpdir(), `nomi-cammove-out-${Date.now()}.mp4`);
    fs.writeFileSync(out, buf);
    return out;
  }
  // nomi-local://asset/<projectId>/<file> → 项目 assets 目录里按文件名找。
  const base = url.split("/").pop();
  if (base) {
    const assetsDir = path.join(projectDir, "assets");
    const walk = (d) => {
      for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          const hit = walk(p);
          if (hit) return hit;
        } else if (e.name === base) return p;
      }
      return null;
    };
    const hit = walk(assetsDir);
    if (hit) return hit;
  }
  throw new Error(`无法定位产物本地文件：${url}`);
}

/** VLM 是非题：复用 judge.config（已配 vision 模型 key）。问运动是否呈现，返回 { pass, confidence, reason }。 */
async function vlmMotionVerdict(cfg, frames, humanMove) {
  const model = cfg.visionModel || cfg.model;
  const content = [
    {
      type: "text",
      text:
        `下面是同一段生成视频的 ${frames.length} 个按时间顺序的抽样帧。判断整段视频是否呈现了「${humanMove}」` +
        `的镜头运动（注意是「相机/镜头」在动，不是画面里物体在动）。拿不准给保守判定。` +
        ` 只输出 JSON: {"pass": boolean, "confidence": 0-1, "reason": string}`,
    },
    ...frames.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  const parsed = await postChatJson(cfg, {
    model,
    temperature: 0,
    stream: false,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content }],
  });
  return {
    pass: parsed.pass === true,
    confidence: Number(parsed.confidence) || 0,
    reason: String(parsed.reason || ""),
    model,
  };
}

const isoDir = path.join(os.tmpdir(), "nomi-camera-move-render-e2e");
let app = null;
let stage1Pass = false;
let stage2Verdict = "SKIP"; // PASS / FAIL / SKIP
try {
  console.log("═══════════════════════════════════════════════════════");
  console.log("运镜工具 深度端到端验证（render → mp4 → video_ref →〔额度门〕真生成 + #6 + VLM）");
  console.log("═══════════════════════════════════════════════════════\n");

  const iso = prepareIsolation(isoDir, { requireCatalog: true });
  const launched = await launchIsolatedApp(repoRoot, iso);
  app = launched.app;
  const win = launched.win;

  const projectDir = await createBlankProject(win, iso.projectsDir);
  await openGenerationAiPanel(win);
  await setAssistantModelPref(win, MODEL_PREF);

  // —— 种子轮：agent 建一个 kind=video 的镜头节点当运镜靶子（create_canvas_nodes 在白名单，零额度）。
  console.log("◆ 种子轮：让 agent 在画布上建一个视频镜头节点（运镜靶子）……");
  {
    const baselineTurnCount = countFinishedTurns(readEventsLog(projectDir));
    await sendAgentMessage(
      win,
      "在画布上创建一个视频镜头节点：一个女孩站在窗边的特写镜头（kind=video）。只建节点，先不要生成。",
    );
    const turn = await approveLoop(win, projectDir, {
      timeoutMs: 180_000,
      log: (m) => console.log(m),
      baselineTurnCount,
      approveSet: new Set(), // 种子轮只需白名单内工具
    });
    await waitForPersistedCanvas(win, projectDir);
    if (!turn.finished) throw new Error(`种子轮未正常收尾（status=${turn.status} ${turn.errorMessage || ""}）`);
  }
  const videoNodes = readNodes(projectDir).filter((n) => n.kind === "video");
  if (videoNodes.length === 0) throw new Error("种子轮后画布上没有 kind=video 节点——无法给运镜提供靶子");
  const targetNodeId = videoNodes[0].id;
  console.log(`✓ 视频靶子节点已就绪：${targetNodeId}\n`);

  // ============================ STAGE 1 — FREE ============================
  console.log("──────────────────────────────────────");
  console.log("STAGE 1 — FREE：离屏渲染 → mp4 → 喂入 video_ref（零生成额度）");
  console.log("──────────────────────────────────────");
  const vendorBeforeStage1 = countVendorRequested(projectDir);
  {
    const baselineTurnCount = countFinishedTurns(readEventsLog(projectDir));
    await sendAgentMessage(win, `画布上已有一个视频镜头节点。${MOVE_REQUEST}`);
    // 批准 create_camera_move：它只触发本地 WebGL 渲染 + ffmpeg 拼片，零额度。
    const turn = await approveLoop(win, projectDir, {
      timeoutMs: 180_000,
      log: (m) => console.log(m),
      baselineTurnCount,
      approveSet: new Set(["create_camera_move"]),
    });
    await waitForPersistedCanvas(win, projectDir);
    if (!turn.approvedTools.includes("create_camera_move")) {
      console.log(
        `⚠️ 本轮 agent 未提议/未批准 create_camera_move（approved=${turn.approvedTools.join(",") || "无"}）。` +
          " 这说明工具选择层没点出运镜——属 agent-eval 关注的洞，不是渲染洞。",
      );
    }
  }

  // host 异步出片：轮询 scene3d.meta.cameraMoveVideo.url 出现，或目标节点 referenceVideoUrls 变非空。
  console.log("◆ 轮询 CameraMoveCaptureHost 产物（离屏采帧 + ffmpeg 拼片，~45s 上限）……");
  const rendered = await pollNodes(
    win,
    projectDir,
    (nodes) => {
      const url = cameraMoveVideoUrl(nodes);
      const target = nodes.find((n) => n.id === targetNodeId);
      return Boolean(url) || referenceVideoUrls(target).length > 0;
    },
    { timeoutMs: 45_000 },
  );

  const stage1Nodes = rendered.nodes;
  const mp4Url = cameraMoveVideoUrl(stage1Nodes);
  const targetNode = stage1Nodes.find((n) => n.id === targetNodeId);
  const refUrls = referenceVideoUrls(targetNode);
  const vendorDuringStage1 = countVendorRequested(projectDir) - vendorBeforeStage1;

  // 三项断言：(a) 产出 mp4 url，(b) 目标节点 referenceVideoUrls 含它，(c) 目标切到 omni（有 video_ref 槽）。
  const aMp4 = Boolean(mp4Url) && /\.mp4(\?|$)/i.test(mp4Url || "");
  const bAttached = Boolean(mp4Url) && refUrls.includes(mp4Url);
  const cOmni = isOmniMode(targetNode);
  const dZeroSpend = vendorDuringStage1 === 0;

  console.log("\n  STAGE 1 断言：");
  console.log(`    (a) 产出 mp4 小片 url            ${aMp4 ? "✓" : "✗"}  ${mp4Url || "(无)"}`);
  console.log(`    (b) 已喂入目标 referenceVideoUrls ${bAttached ? "✓" : "✗"}  [${refUrls.join(", ")}]`);
  console.log(`    (c) 目标切到 omni（含 video_ref）  ${cOmni ? "✓" : "✗"}  modeId=${targetNode?.meta?.archetype?.modeId || "(无)"}`);
  console.log(`    (d) 零生成额度 vendor.requested=0  ${dZeroSpend ? "✓" : "✗"}  (本段实测 ${vendorDuringStage1})`);

  if (!rendered.ok) {
    console.log(`\n  ✗ STAGE 1 FAIL：host 产物在 ${Math.round(rendered.elapsedMs / 1000)}s 内未出现（超时，不冒充成功）。`);
    if (!hasFfmpeg) console.log("    （本机无 ffmpeg → 拼片必失败，这是根因，请先装 ffmpeg）");
  }
  stage1Pass = aMp4 && bAttached && cOmni && dZeroSpend && rendered.ok;
  console.log(`\n  STAGE 1 结论：${stage1Pass ? "PASS" : "FAIL"}\n`);

  // ============================ STAGE 2 — CREDIT-GATED ============================
  console.log("──────────────────────────────────────");
  console.log("STAGE 2 — CREDIT-GATED：真生成 + #6 mp4 上传 + VLM 运动核验");
  console.log("──────────────────────────────────────");
  if (!process.env.NOMI_SPEND_OK) {
    console.log("  SKIP STAGE 2：未设 NOMI_SPEND_OK=1（真生成会花生成额度）。");
    console.log("  要跑：APIMART_E2E=1 NOMI_SPEND_OK=1 node tests/ux/camera-move-render-e2e.mjs");
    stage2Verdict = "SKIP";
  } else if (!stage1Pass) {
    console.log("  SKIP STAGE 2：STAGE 1 未通过，没有可生成的喂入态，跳过真生成（不浪费额度）。");
    stage2Verdict = "SKIP";
  } else {
    const judgeCfg = loadJudgeConfig();
    if (!judgeCfg) {
      console.log("  ⚠️ 缺 evals/judge.config.json（VLM 打分需要）——仍会真生成 + 判 #6，但跳过 VLM 运动核验。");
    }

    // 在目标视频节点上触发真生成：让 agent 跑 run_generation_batch（costy，需批准；mp4 在此被上传 = #6）。
    console.log("◆ 触发真生成（run_generation_batch）——mp4 在此被上传到 vendor（#6 风险点）……");
    const baselineTurnCount = countFinishedTurns(readEventsLog(projectDir));
    await sendAgentMessage(
      win,
      "现在请生成这个视频镜头节点（用它已注入的运镜参考视频）。直接运行生成。",
    );
    await approveLoop(win, projectDir, {
      timeoutMs: 180_000,
      log: (m) => console.log(m),
      baselineTurnCount,
      approveSet: new Set(["create_camera_move", "run_generation_batch"]),
    });

    // 轮询节点终态：成功（result.providerUrl/url）或失败（status=error + error 文案）。
    // omni（全能参考）+ mp4 上传 + 代理下，真生成常 >5min → 默认 10min，可用 NOMI_GEN_POLL_MS 调。
    const genPollMs = Number(process.env.NOMI_GEN_POLL_MS) || 600_000;
    console.log(`◆ 轮询生成终态（成功出片 or 上传/生成失败，~${Math.round(genPollMs / 60000)}min 上限）……`);
    const finished = await pollNodes(
      win,
      projectDir,
      (nodes) => {
        const n = nodes.find((x) => x.id === targetNodeId);
        const url = n?.result?.providerUrl || n?.result?.url;
        const failed = n?.status === "error" || (typeof n?.error === "string" && n.error.trim().length > 0);
        return Boolean(url) || failed;
      },
      { timeoutMs: genPollMs, intervalMs: 3000 },
    );

    const node = finished.nodes.find((x) => x.id === targetNodeId);
    const outUrl = node?.result?.providerUrl || node?.result?.url || "";
    const nodeError = (typeof node?.error === "string" && node.error.trim()) || "";
    const nodeFailed = node?.status === "error" || Boolean(nodeError);

    // #6 判定：上传失败 → 节点 error 含上传错误原话（runtime 把 raw message 落 node.error）。
    // 上传在 executeProfileOperation 内、早于 traceVendorRequested，故 #6 失败时 vendor.call.requested
    // 往往「没有」记录 → 只信节点态判 #6，不信 vendor 事件。
    const uploadErrorPat = /上传响应缺少可达 URL|素材上传失败|uploads\/images|multipart|HTTP 4\d\d|HTTP 5\d\d/i;
    const looksLikeUploadFail = nodeFailed && uploadErrorPat.test(nodeError);

    console.log("\n  #6（mp4 上传到 vendor）判定：");
    if (!finished.ok) {
      console.log(`    SKIP/UNKNOWN：生成在 ${Math.round(finished.elapsedMs / 1000)}s 内既未出片也未报错（超时，不冒充成功）。`);
      stage2Verdict = "FAIL";
    } else if (looksLikeUploadFail) {
      console.log(`    ✗ FAIL（#6 命中）：mp4 被 apimart /uploads/images 拒收 / 上传无可达 URL。`);
      console.log(`      节点错误原话：${nodeError.slice(0, 400)}`);
      console.log(`      → 修法方向：给视频用 video-aware 上传端点 / 让 mp4 走可达公网 URL，而非图片端点。`);
      stage2Verdict = "FAIL";
    } else if (nodeFailed) {
      console.log(`    ⚠️ 生成失败，但不像上传层（#6）问题（可能是模型/参数/算力）。`);
      console.log(`      节点错误原话：${nodeError.slice(0, 400)}`);
      stage2Verdict = "FAIL";
    } else if (outUrl) {
      console.log(`    ✓ PASS：mp4 上传成功且模型出片。产物 URL：${outUrl}`);

      // —— VLM 运动核验 —— 下载产物 → 抽帧 → 问「是否呈现请求的运镜」。
      console.log("\n  VLM 运动核验：");
      if (!judgeCfg) {
        console.log("    SKIP：无 judge.config.json，无法调 VLM（产物已出片，请人眼看上面的 URL）。");
        stage2Verdict = "PASS"; // 出片即 #6 通过；VLM 仅作质量增信，缺它不翻案
      } else if (!hasFfmpeg) {
        console.log("    SKIP：本机无 ffmpeg，无法抽帧（产物已出片，请人眼看上面的 URL）。");
        stage2Verdict = "PASS";
      } else {
        try {
          const localFile = await materializeOutputVideo(outUrl, projectDir);
          const frames = sampleVideoFrames(localFile, 6);
          if (frames.length === 0) {
            console.log("    SKIP：抽帧为空（产物已出片，请人眼看 URL）。");
            stage2Verdict = "PASS";
          } else {
            const verdict = await vlmMotionVerdict(judgeCfg, frames, MOVE_HUMAN);
            console.log(
              `    ${verdict.pass ? "✓ 呈现了" : "✗ 未明显呈现"}「${MOVE_HUMAN}」运镜` +
                `（置信 ${verdict.confidence.toFixed(2)}，VLM=${verdict.model}）`,
            );
            console.log(`      理由：${verdict.reason.slice(0, 300)}`);
            console.log(`      产物（请人眼复核）：${outUrl}`);
            // #6 通过即 STAGE 2 主目标达成；VLM 是非题做增信，不通过仅警示不翻 #6 的 PASS。
            stage2Verdict = "PASS";
            if (!verdict.pass) console.log("    ⚠️ VLM 认为运镜不明显——记下供人眼裁决，不影响 #6 PASS。");
          }
        } catch (e) {
          console.log(`    SKIP：VLM 链路异常（${e?.message || e}）。产物已出片，请人眼看 URL：${outUrl}`);
          stage2Verdict = "PASS";
        }
      }
    } else {
      console.log("    UNKNOWN：既无产物 URL 也无错误（异常态）。");
      stage2Verdict = "FAIL";
    }
    console.log(`\n  STAGE 2 结论：${stage2Verdict}`);
  }

  // ============================ 总结 ============================
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`STAGE 1（FREE render+attach）：${stage1Pass ? "PASS" : "FAIL"}`);
  console.log(`STAGE 2（real gen + #6 + VLM）：${stage2Verdict}`);
  console.log("═══════════════════════════════════════════════════════");

  await app.close();
  // 退出码：STAGE 1 必须过；STAGE 2 SKIP 不算失败，FAIL 才算。
  const ok = stage1Pass && stage2Verdict !== "FAIL";
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n✗ 致命错误：${err?.message || err}`);
  if (app) await app.close().catch(() => undefined);
  process.exit(1);
}
