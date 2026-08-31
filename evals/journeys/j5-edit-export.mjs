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
        await ctx.win.getByRole("button", { name: "适应画布", exact: true }).first().click().catch(() => {});
        const node = ctx.win.locator(`[data-node-id="${NODE_ID}"]`).first();
        await node.click({ position: { x: 24, y: 24 }, timeout: 8_000 });
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
        await ctx.win.getByRole("button", { name: "适应画布", exact: true }).first().click().catch(() => {});
        await ctx.win.locator(`[data-node-id="${NODE_ID}"]`).first().click({ position: { x: 24, y: 24 } });
        await ctx.win.locator(".generation-canvas-v2-node__composer").waitFor({ state: "visible", timeout: 8_000 });
      },
      async verify(ctx) {
        const promptText = await ctx.win.locator(".generation-canvas-v2-node__prompt-input").first().innerText().catch(() => "");
        const regenerateVisible = await ctx.win.getByRole("button", { name: "重新生成", exact: true }).first().isVisible().catch(() => false);
        const composerGeometry = await ctx.win.locator(".generation-canvas-v2-node__composer-card").first().evaluate((element) => {
          const stage = element.closest(".generation-canvas-v2__stage");
          const rect = element.getBoundingClientRect();
          const stageRect = stage?.getBoundingClientRect();
          if (!stageRect) return { withinStage: false, reason: "stage missing" };
          const promptRect = element.querySelector(".generation-canvas-v2-node__prompt-input")?.getBoundingClientRect();
          const actionRect = element.querySelector('button[aria-label="重新生成"]')?.getBoundingClientRect();
          const tolerance = 1;
          const promptVisibleHeight = promptRect
            ? Math.max(0, Math.min(promptRect.bottom, rect.bottom) - Math.max(promptRect.top, rect.top))
            : 0;
          const primaryActionWithinCard = Boolean(actionRect
            && actionRect.top >= rect.top - tolerance
            && actionRect.right <= rect.right + tolerance
            && actionRect.bottom <= rect.bottom + tolerance
            && actionRect.left >= rect.left - tolerance);
          return {
            withinStage: (
              rect.top >= stageRect.top - tolerance
              && rect.right <= stageRect.right + tolerance
              && rect.bottom <= stageRect.bottom + tolerance
              && rect.left >= stageRect.left - tolerance
            ),
            promptVisibleHeight,
            primaryActionWithinCard,
            composer: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
            stage: { top: stageRect.top, right: stageRect.right, bottom: stageRect.bottom, left: stageRect.left },
          };
        }).catch((error) => ({ withinStage: false, reason: String(error) }));
        return [
          check("重开后 prompt 没有丢失", promptText.includes("清晨露营桌上"), promptText),
          check("旧结果节点明确提供重新生成入口", regenerateVisible, regenerateVisible ? "" : "regenerate button not visible"),
          check("悬浮编辑器完整位于画布视口内", composerGeometry.withinStage, JSON.stringify(composerGeometry)),
          check("提示词与重新生成控件同时可操作", composerGeometry.promptVisibleHeight >= 20 && composerGeometry.primaryActionWithinCard, JSON.stringify(composerGeometry)),
        ];
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
