import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { check } from "../lib/journeyRunner.mjs";
import { dismissSplashIfPresent, waitForPersistedCanvas } from "../lib/isoApp.mjs";

const require = createRequire(import.meta.url);
const ffprobePath = require("@ffprobe-installer/ffprobe").path;
const PROJECT_ID = "j5-existing-project";
const PROJECT_NAME = "已有项目：咖啡机短片";
const NODE_ID = "j5-shot-1";
const NEW_PROMPT = "清晨露营桌上，钛灰色咖啡机被暖阳照亮，镜头缓慢推近，蒸汽清晰可见。";
// 浮框钉在节点正下方的判据（与 src/workbench/generationCanvas/nodes/composerCanvasPlacement.ts 同一组数）：
// 卡顶边 = 节点底边 + 14×缩放、卡中线 = 节点中线、屏幕宽恒 560。
const COMPOSER_GAP = 14;
const COMPOSER_WIDTH = 560;
// 摆节点用：缩到不超过这个倍率、节点顶边离舞台顶边这么远——节点 + 浮框（卡高 ≤400）才放得进 1100×720 的舞台。
const PLACE_MAX_ZOOM = 0.7;
const PLACE_TOP_INSET = 24;

function seedExistingProject(repoRoot, projectsDir) {
  const projectDir = path.join(projectsDir, PROJECT_NAME);
  const assetDir = path.join(projectDir, "assets", "generated");
  fs.mkdirSync(path.join(projectDir, ".nomi"), { recursive: true });
  fs.mkdirSync(assetDir, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "resources/onboarding-demo/shot-3.jpg"), path.join(assetDir, "coffee.jpg"));
  const url = `nomi-local://asset/${encodeURIComponent(PROJECT_ID)}/assets/generated/coffee.jpg`;
  const node = {
    id: NODE_ID,
    kind: "image",
    categoryId: "shots",
    title: "镜头 1：露营咖啡机",
    prompt: "旧提示词：咖啡机放在桌上。",
    position: { x: 160, y: 140 },
    exactPosition: true,
    size: { width: 360, height: 280 },
    status: "success",
    result: { id: "j5-result-1", type: "image", url, createdAt: 1 },
  };
  const generationCanvas = {
    nodes: [node],
    edges: [],
    selectedNodeIds: [],
    groups: [],
    canvasZoom: 1,
    canvasPan: { x: 0, y: 0 },
  };
  const timeline = {
    version: 1,
    fps: 24,
    scale: 1,
    playheadFrame: 0,
    tracks: [
      {
        id: "imageTrack",
        type: "image",
        label: "图片轨",
        clips: [{
          id: "j5-clip-1",
          type: "image",
          sourceNodeId: NODE_ID,
          label: "镜头 1",
          startFrame: 0,
          endFrame: 48,
          frameCount: 48,
          offsetStartFrame: 0,
          offsetEndFrame: 0,
          url,
        }],
      },
      { id: "videoTrack", type: "video", label: "视频轨", clips: [] },
      { id: "audioTrack", type: "audio", label: "音频轨", clips: [] },
    ],
    textClips: [],
  };
  const payload = { workbenchDocument: null, timeline, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false };
  const project = {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    version: 2,
    createdAt: 1,
    updatedAt: Date.now(),
    savedAt: Date.now(),
    revision: 1,
    lastKnownRootPath: projectDir,
    ...payload,
    payload,
  };
  const serialized = JSON.stringify(project, null, 2);
  fs.writeFileSync(path.join(projectDir, "project.json"), serialized);
  fs.writeFileSync(path.join(projectDir, ".nomi", "project.json"), serialized);
  return projectDir;
}

/**
 * 量 composer 卡片的可操作性几何。**只读，不改 DOM**——断言里改样式会污染它自己要验的那个现场。
 *
 * 为什么不能只看「元素可见」：Playwright 的 `isVisible()` 只要求包围盒非空，
 * 被 `overflow-hidden` 裁到卡外的按钮**照样报 visible**。2026-08-26 win32 塌陷里
 * 「有重新生成入口」这条就是这么绿着的，而按钮其实一格都点不到。所以这里量的是
 * 「提示词在卡内露出多高」「主行动钮是否真的落在卡矩形内」，以及两者中心点是否真的点得中自己。
 *
 * 2026-09-25 起浮框「钉在节点正下方、宽度固定、被挡就挡」：不再 clamp 进视口、不再翻到上方，
 * 所以「整张卡在舞台内」不再是产品承诺，改量「钉住」（顶边 / 中线 / 宽）；
 * 「点得到」由调用方先把节点摆到舞台上部（placeNodeNearStageTop）再量，不指望浮框自己挪进来。
 */
async function measureComposerGeometry(win) {
  return win.locator(".generation-canvas-v2-node__composer-card").first().evaluate((element, { gap, width }) => {
    const stage = element.closest(".generation-canvas-v2__stage");
    const rect = element.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    if (!stageRect) return { pinned: false, reason: "stage missing" };
    const promptElement = element.querySelector(".generation-canvas-v2-node__prompt-input");
    const actionElement = element.querySelector('button[aria-label="重新生成"]');
    const promptRect = promptElement?.getBoundingClientRect();
    const actionRect = actionElement?.getBoundingClientRect();
    const tolerance = 1;
    // 真实命中：中心点最顶层的元素就是它自己（或它的后代）。被停靠区盖住、伸出舞台被裁，这里都会是 false。
    const hits = (target) => {
      if (!target) return false;
      const box = target.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && (hit === target || target.contains(hit)));
    };
    const promptVisibleHeight = promptRect
      ? Math.max(0, Math.min(promptRect.bottom, rect.bottom) - Math.max(promptRect.top, rect.top))
      : 0;
    const primaryActionWithinCard = Boolean(actionRect
      && actionRect.top >= rect.top - tolerance
      && actionRect.right <= rect.right + tolerance
      && actionRect.bottom <= rect.bottom + tolerance
      && actionRect.left >= rect.left - tolerance);
    // 失败时的取证包：塌陷是几何问题，只报一个 false 没法隔着 CI 判因。
    const anchor = element.parentElement;
    const nodeRect = anchor?.parentElement?.getBoundingClientRect();
    const handleRect = document.querySelector(".workbench-generation__timeline-handle")?.getBoundingClientRect();
    // 画布缩放读 React Flow 视口自己的 transform（DOMMatrix.a）——量的是用户眼前那一帧，不读 store。
    const viewportEl = document.querySelector(".react-flow__viewport");
    const zoom = viewportEl ? new DOMMatrixReadOnly(getComputedStyle(viewportEl).transform).a : 1;
    const pin = nodeRect ? {
      cardTop: rect.top,
      expectedTop: nodeRect.bottom + gap * zoom,
      centreDelta: (rect.left + rect.right) / 2 - (nodeRect.left + nodeRect.right) / 2,
      width: rect.width,
      zoom,
    } : null;
    return {
      pinned: Boolean(pin
        && Math.abs(pin.cardTop - pin.expectedTop) <= 2
        && Math.abs(pin.centreDelta) <= 2
        && Math.abs(pin.width - width) <= 1),
      pin,
      promptVisibleHeight,
      primaryActionWithinCard,
      promptHittable: hits(promptElement),
      primaryActionHittable: hits(actionElement),
      composer: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
      stage: { top: stageRect.top, right: stageRect.right, bottom: stageRect.bottom, left: stageRect.left },
      diag: {
        cardHeight: rect.height,
        scrollHeight: element.scrollHeight,
        styleMaxHeight: element.style.maxHeight,
        styleMinHeight: element.style.minHeight,
        node: nodeRect ? { top: nodeRect.top, bottom: nodeRect.bottom, height: nodeRect.height } : null,
        spaceAbove: nodeRect ? nodeRect.top - stageRect.top : null,
        spaceBelow: nodeRect ? stageRect.bottom - nodeRect.bottom : null,
        timelineHandle: handleRect ? { top: handleRect.top, left: handleRect.left, right: handleRect.right } : null,
        hasWindowbar: Boolean(document.querySelector(".workbench-windowbar")),
      },
    };
  }, { gap: COMPOSER_GAP, width: COMPOSER_WIDTH }).catch((error) => ({ pinned: false, reason: String(error) }));
}

/** 舞台 / 目标节点 / 画布缩放的现量（屏幕坐标）。只读。 */
async function readCanvasView(win) {
  return win.evaluate((nodeId) => {
    const stage = document.querySelector(".generation-canvas-v2__stage");
    const node = document.querySelector(`[data-node-id="${nodeId}"]`);
    const viewportEl = document.querySelector(".react-flow__viewport");
    if (!stage || !node || !viewportEl) return null;
    const box = (element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return { zoom: new DOMMatrixReadOnly(getComputedStyle(viewportEl).transform).a, stage: box(stage), node: box(node) };
  }, NODE_ID).catch(() => null);
}

/**
 * 像人一样把节点摆到舞台上部、水平居中，再选中它，让浮框（钉在节点正下方）落在屏上。
 *
 * 为什么需要这一步：2026-09-25 起浮框不再 clamp 进视口，节点摆在哪、浮框就在它正下方哪儿——
 * 节点在舞台中下部时浮框伸出舞台被裁是**预期**（用户拍板「被挡就挡」）。人在这种时候会先把节点挪上来再写提示词，
 * 走查照做：滚轮缩小到 ≤PLACE_MAX_ZOOM（节点变小、浮框屏幕尺寸不变），再拖空白平移，全程真实鼠标，不灌 store。
 * 位置由现量算出、每一步用状态等待确认真的动了，不依赖上一个里程碑留下的视口偏移。
 */
async function placeNodeNearStageTop(win) {
  // 走查断言层与空白命中判据只在真跑旅程时才载入：`journeyContracts.test.ts`（vitest）会 import 本文件，
  // 顶层 import 会把 @playwright/test 的 expect 一起拖进 vitest 的收集阶段——不让两套 expect 同进程共存。
  const { expect } = await import("../../tests/ux/_assert.mjs");
  const { findCanvasBlankPoint } = await import("../../tests/ux/_canvasHit.mjs");
  // 先点真实的「适应视图」把节点收回视野（只渲染可见节点：节点在视野外时 DOM 里根本没有它，量不到也点不到）。
  // 这里以前点的是「适应画布」——那颗按钮不存在（真名是「适应视图」），`.catch(() => {})` 把它静默吞成了空操作。
  await win.getByLabel("适应视图", { exact: true }).first().click({ timeout: 8_000 });
  let lastTransform = null;
  await expect.poll(async () => {
    const transform = await win.evaluate(() => {
      const viewportEl = document.querySelector(".react-flow__viewport");
      return viewportEl ? getComputedStyle(viewportEl).transform : null;
    });
    const stable = transform !== null && transform === lastTransform;
    lastTransform = transform;
    return stable;
  }, { message: "适应视图后画布视口必须落定（连续两次采样相同）" }).toBe(true);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const view = await readCanvasView(win);
    if (!view) throw new Error("量不到舞台 / 节点 / 画布视口");
    if (view.zoom <= PLACE_MAX_ZOOM) break;
    const point = await findCanvasBlankPoint(win, { inset: 48 });
    if (!point) throw new Error("画布上找不到空白点，没法滚轮缩小");
    await win.mouse.move(point.x, point.y);
    await win.mouse.wheel(0, 120);
    await expect.poll(async () => (await readCanvasView(win))?.zoom ?? view.zoom, { message: "滚轮缩小后画布缩放必须真的变小" })
      .toBeLessThan(view.zoom);
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const view = await readCanvasView(win);
    if (!view) throw new Error("量不到舞台 / 节点 / 画布视口");
    const dx = (view.stage.left + view.stage.width / 2) - (view.node.left + view.node.width / 2);
    const dy = (view.stage.top + PLACE_TOP_INSET) - view.node.top;
    if (Math.abs(dx) <= 4 && Math.abs(dy) <= 4) break;
    const from = await findCanvasBlankPoint(win, { inset: 48 });
    if (!from) throw new Error("画布上找不到空白点，没法拖动平移");
    // 终点留在舞台内（离边 8px）；一次挪不完就下一轮接着挪。
    const to = {
      x: Math.min(Math.max(from.x + dx, view.stage.left + 8), view.stage.right - 8),
      y: Math.min(Math.max(from.y + dy, view.stage.top + 8), view.stage.bottom - 8),
    };
    const before = `${Math.round(view.node.left)},${Math.round(view.node.top)}`;
    await win.mouse.move(from.x, from.y);
    await win.mouse.down();
    await win.mouse.move(to.x, to.y, { steps: 12 });
    await win.mouse.up();
    await expect.poll(async () => {
      const next = await readCanvasView(win);
      return next ? `${Math.round(next.node.left)},${Math.round(next.node.top)}` : before;
    }, { message: "拖空白平移后节点必须真的挪了" }).not.toBe(before);
  }
  const placed = await readCanvasView(win);
  const placedOk = Boolean(placed
    && placed.zoom <= PLACE_MAX_ZOOM
    && Math.abs(placed.node.top - (placed.stage.top + PLACE_TOP_INSET)) <= 8
    && Math.abs((placed.node.left + placed.node.width / 2) - (placed.stage.left + placed.stage.width / 2)) <= 8);
  if (!placedOk) throw new Error(`节点没能摆到舞台上部：${JSON.stringify(placed)}`);
  await win.locator(`[data-node-id="${NODE_ID}"]`).first().click({ position: { x: 24, y: 24 } });
  await win.locator(".generation-canvas-v2-node__composer").first().waitFor({ state: "visible", timeout: 8_000 });
  // 浮框位置是节点尺寸 + 缩放的纯函数，没有让位动画；等它按判据钉住即可（状态等待，不是墙钟）。
  await expect.poll(async () => (await measureComposerGeometry(win)).pinned, { message: "选中后浮框必须钉在节点正下方" }).toBe(true);
}

async function setWindowContentSize(win, app, width, height) {
  const browserWindow = await app.browserWindow(win);
  await browserWindow.evaluate((window, size) => {
    window.setBounds({ width: size.width, height: size.height });
    window.center();
  }, { width, height });
  await win.waitForTimeout(600);
}

function latestExport(projectDir, startedAt) {
  const exportDir = path.join(projectDir, "exports");
  if (!fs.existsSync(exportDir)) return null;
  return fs.readdirSync(exportDir)
    // ffmpeg 的在写临时文件也叫 .mp4：exportPaths.ts:69 把它命名成 <final>.partial.mp4，
    // 于是 endsWith(".mp4") 必然把半成品当成品捞进来。
    .filter((name) => name.endsWith(".mp4") && !name.endsWith(".partial.mp4"))
    .map((name) => path.join(exportDir, name))
    // stat 只做一次、结果随条目带走。原来 filter 和 sort 各 stat 一次，ffmpeg 在这两次之间
    // 把 .partial.mp4 改名成最终名，第二次 stat 就 ENOENT 抛穿，报成「导出失败」——
    // 而产品其实导出成功了。Windows 导出慢，正好把这个竞态窗口撞开；Linux/mac 只是没撞上，不是没有。
    .flatMap((file) => {
      try {
        const stat = fs.statSync(file);
        return [{ file, mtimeMs: stat.mtimeMs, size: stat.size }];
      } catch {
        return []; // 竞态中被改名/删除的文件跳过即可，不是错误
      }
    })
    .filter((entry) => entry.mtimeMs >= startedAt && entry.size > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.file || null;
}

export default {
  id: "j5-edit-export",
  name: "修改项目并进入导出",
  needsAgent: false,
  smoke: true,
  successCriterion: "打开已有项目，修改 prompt 后重开仍保留，时间轴可见并真实导出有效 MP4",
  async prepare({ iso, repoRoot }) {
    return { projectDir: seedExistingProject(repoRoot, iso.projectsDir) };
  },
  async setup({ win, prepared }) {
    await dismissSplashIfPresent(win);
    const card = win.locator('[data-project-card="true"]', { hasText: PROJECT_NAME }).first();
    await card.waitFor({ state: "visible", timeout: 10_000 });
    await card.click();
    await win.waitForURL(/projectId=/, { timeout: 10_000 });
    return prepared.projectDir;
  },
  milestones: [
    {
      id: "modify-project",
      title: "打开已有节点并修改提示词",
      async act(ctx) {
        await ctx.win.getByRole("button", { name: "生成", exact: true }).first().click();
        await ctx.win.locator(`[data-node-id="${NODE_ID}"]`).first().waitFor({ state: "visible", timeout: 8_000 });
        // 浮框钉在节点正下方、不再自己挪进视口：先把节点摆到舞台上部再选中，提示词框才在屏上。
        await placeNodeNearStageTop(ctx.win);
        const prompt = ctx.win.locator(".generation-canvas-v2-node__prompt-input").first();
        await prompt.waitFor({ state: "visible", timeout: 8_000 });
        await prompt.fill(NEW_PROMPT);
        await prompt.press("Tab");
        await waitForPersistedCanvas(ctx.win, ctx.projectDir, { settleMs: 500, timeoutMs: 8_000 });
      },
      async verify(ctx) {
        const node = ctx.nodes().find((candidate) => candidate.id === NODE_ID);
        const promptText = await ctx.win.locator(".generation-canvas-v2-node__prompt-input").first().innerText().catch(() => "");
        return [
          check("旧节点已打开", Boolean(node), NODE_ID),
          check("新 prompt 已写入 UI", promptText.includes("清晨露营桌上"), promptText),
          check("新 prompt 已持久化", node?.prompt === NEW_PROMPT, node?.prompt || "missing"),
        ];
      },
    },
    {
      id: "reopen-project",
      title: "回到项目库并重开验证持久化",
      async act(ctx) {
        await ctx.win.getByRole("button", { name: "返回项目库", exact: true }).click();
        const card = ctx.win.locator('[data-project-card="true"]', { hasText: PROJECT_NAME }).first();
        await card.waitFor({ state: "visible", timeout: 8_000 });
        await card.click();
        await ctx.win.getByRole("button", { name: "生成", exact: true }).first().click();
        await ctx.win.locator(`[data-node-id="${NODE_ID}"]`).first().waitFor({ state: "visible", timeout: 8_000 });
        await placeNodeNearStageTop(ctx.win);
      },
      async verify(ctx) {
        const promptText = await ctx.win.locator(".generation-canvas-v2-node__prompt-input").first().innerText().catch(() => "");
        const regenerateVisible = await ctx.win.getByRole("button", { name: "重新生成", exact: true }).first().isVisible().catch(() => false);
        const composerGeometry = await measureComposerGeometry(ctx.win);
        return [
          check("重开后 prompt 没有丢失", promptText.includes("清晨露营桌上"), promptText),
          check("旧结果节点明确提供重新生成入口", regenerateVisible, regenerateVisible ? "" : "regenerate button not visible"),
          check("悬浮编辑器钉在节点正下方（顶边 = 节点底边 + 14×缩放、中线对齐、宽 560）", composerGeometry.pinned, JSON.stringify(composerGeometry)),
          check(
            "提示词与重新生成控件同时可操作",
            composerGeometry.promptVisibleHeight >= 20 && composerGeometry.primaryActionWithinCard
              && composerGeometry.promptHittable && composerGeometry.primaryActionHittable,
            JSON.stringify(composerGeometry),
          ),
        ];
      },
    },
    {
      // 回归门（2026-08-26）：composer 在**窗口下限**下仍须可操作。
      //
      // 为什么单独立一条：原 `reopen-project` 那条断言 2026-08-17 就在，win32 上红了 9 天没人看见——
      // 根因是 CI 当时没有 Windows job。但塌陷本身**与平台无关**（mac 上已复刻）：win32 只是恒定少
      // 32px 自绘标题栏（`WorkbenchShell.tsx` 的 windowbar，mac/Linux 走原生 chrome 不渲染），离悬崖最近。
      // 所以与其等一个 2x 计费的 Windows runner，不如把复现条件（窄 stage）直接做进走查——
      // **这条在 Linux CI 上就会红**，本类问题不再依赖「有没有 Windows job」。
      //
      // 1100x720 = BrowserWindow 的 minWidth/minHeight（`electron/main.ts`），即我们承诺支持的最小窗口。
      //
      // 2026-09-25 起浮框「钉在节点正下方、被挡就挡」，不再 clamp 进视口：窄舞台下它不会自己挪进来，
      // 所以这条改成「人把节点挪到舞台上部后，浮框钉在下方、卡不塌、提示词与生成钮真的点得中」——
      // 塌陷（卡高被挤扁、按钮被裁到卡外）这一类仍然在这里红。
      id: "composer-usable-at-min-window",
      title: "窗口缩到下限后提示词与生成钮仍可操作",
      async act(ctx) {
        await setWindowContentSize(ctx.win, ctx.app, 1100, 720);
        // 节点位置按窄舞台现量重新摆（缩放 + 平移都由现量算出），不继承上一里程碑的视口偏移——
        // 否则这条会为了错误的理由变绿（实测栽过：链式改尺寸时旧偏移把空间白送给了下一档）。
        await placeNodeNearStageTop(ctx.win);
        ctx.minWindowComposer = await measureComposerGeometry(ctx.win);
        // ⚠️ 这里**故意不还原窗口**。harness 的顺序是 act → 截图 → verify，
        // 在 act 末尾还原会让「窗口缩到下限」这条里程碑的取证截图拍到一个宽窗口——
        // 断言量的是窄窗口、截图却是宽窗口，人眼复核时等于零证据（同 e0477f91 治的那一类）。
        // 还原挪到 verify 末尾（截图之后），见下。
      },
      async verify(ctx) {
        const geometry = ctx.minWindowComposer || { reason: "not measured" };
        const evidence = JSON.stringify(geometry);
        try {
          return [
            check("窗口下限下 composer 未塌陷", (geometry.diag?.cardHeight || 0) >= 150, evidence),
            check(
              "窗口下限下提示词与生成钮同时可操作",
              geometry.promptVisibleHeight >= 20 && geometry.primaryActionWithinCard
                && geometry.promptHittable === true && geometry.primaryActionHittable === true,
              evidence,
            ),
            check("窗口下限下悬浮编辑器钉在节点正下方（顶边 = 节点底边 + 14×缩放、中线对齐、宽 560）", geometry.pinned === true, evidence),
          ];
        } finally {
          // 截图已在 verify 之前拍完（拍到的是真正被断言的窄窗口），这里再还原给后续里程碑。
          // finally：断言抛了也必须还原，否则导出里程碑会在窄窗口里跑。
          await setWindowContentSize(ctx.win, ctx.app, 1680, 1050);
        }
      },
    },
    {
      id: "export-mp4",
      title: "进入时间轴并真实导出 MP4",
      async act(ctx) {
        await ctx.win.locator('[aria-label="去出片"]:visible').first().click({ timeout: 5_000 });
        await ctx.win.locator('[data-workspace-mode="preview"]').waitFor({ state: "attached", timeout: 8_000 });
        await ctx.win.locator(".workbench-timeline-clip").first().waitFor({ state: "visible", timeout: 10_000 });
        ctx.exportStartedAt = Date.now();
        await ctx.win.getByRole("button", { name: "导出 MP4", exact: true }).first().click();
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          ctx.exportPath = latestExport(ctx.projectDir, ctx.exportStartedAt);
          if (ctx.exportPath) break;
          await ctx.win.waitForTimeout(1_000);
        }
        if (!ctx.exportPath) throw new Error("120 秒内未找到导出的 MP4");
      },
      verify(ctx) {
        let probe = "";
        try {
          probe = execFileSync(ffprobePath, [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_name,width,height,duration",
            "-of", "json",
            ctx.exportPath,
          ], { encoding: "utf8" });
        } catch (error) {
          probe = error instanceof Error ? error.message : String(error);
        }
        return [
          check("时间轴里有已有镜头", true, "j5-clip-1", "outcome"),
          check("真实 MP4 已导出且非空", Boolean(ctx.exportPath && fs.statSync(ctx.exportPath).size > 0), ctx.exportPath || "missing", "outcome"),
          check("ffprobe 识别到视频流", /\"codec_name\"\s*:\s*\"(?:h264|hevc|mpeg4)\"/.test(probe), probe, "outcome"),
        ];
      },
    },
  ],
};
