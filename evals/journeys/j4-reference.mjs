import fs from "node:fs";
import path from "node:path";
import { check } from "../lib/journeyRunner.mjs";
import { backToLibrary } from "../../tests/ux/_shell.mjs";
import { createBlankProject, waitForPersistedCanvas } from "../lib/isoApp.mjs";
import { requireRealMediaAssets } from "../../tests/ux/fixtures/realMedia.mjs";

// 用到时才取登记素材：旅程注册表的契约测试也导入本模块，那里（含 CI）没有 NOMI_REAL_MEDIA_DIR。
const REAL_MEDIA = ["image-4k-png"];
function realImage() {
  return requireRealMediaAssets(REAL_MEDIA).assets.get(REAL_MEDIA[0]).file;
}

function containsFile(root, fileName) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.name === fileName) return true;
    }
  }
  return false;
}

export default {
  id: "j4-reference",
  name: "参考图驱动生成准备",
  needsAgent: false,
  realMedia: REAL_MEDIA, // 要私有真素材：CI 不选它（scripts/eval-journey-selection.mjs）
  smoke: false,
  successCriterion: "真实上传本地图片，图片进入项目素材并挂到视频节点参考槽，参数可执行",
  async setup({ win, iso }) {
    realImage(); // 缺素材在起步就红，不等走到上传那一步
    const startedAt = Date.now();
    const projectDir = await createBlankProject(win, iso.projectsDir);
    fs.writeFileSync(path.join(projectDir, ".nomi", "real-media-cold-open.json"), JSON.stringify({ journey: "j4-reference", elapsedMs: Date.now() - startedAt, asset: "image-4k-png" }));
    return projectDir;
  },
  milestones: [
    {
      id: "reference-target",
      title: "建立支持图片参考的视频目标",
      async act(ctx) {
        await ctx.win.getByRole("button", { name: "生成", exact: true }).first().click();
        await ctx.win.locator("[aria-label=\"添加视频节点\"]").first().click({ timeout: 10_000 });
        const node = ctx.win.locator("[data-kind=\"video\"][data-node-id]").last();
        await node.waitFor({ state: "visible", timeout: 10_000 });
        await node.locator("[contenteditable=\"true\"]").last().fill("钛灰色便携咖啡机在露营桌上缓慢环绕展示");
        await ctx.win.waitForTimeout(800);
      },
      verify(ctx) {
        const nodes = ctx.created();
        const target = nodes.find((node) => node.kind === "video");
        return [
          check("目标 video 节点存在", Boolean(target), "", "outcome"),
          check("目标绑定模型与 archetype", Boolean(target?.meta?.modelKey && target?.meta?.archetype?.id), JSON.stringify(target?.meta || {}), "outcome"),
          check("目标设置 16:9 和可执行时长", (target?.meta?.aspect_ratio === "16:9" || target?.meta?.size === "16:9") && Number(target?.meta?.duration) > 0, JSON.stringify(target?.meta || {}), "outcome"),
        ];
      },
    },
    {
      id: "upload-reference",
      title: "真实上传图片并挂到节点参考槽",
      async act(ctx) {
        const target = ctx.created().find((node) => node.kind === "video");
        if (!target) throw new Error("找不到真实视频参考节点");
        await ctx.win.getByRole("button", { name: "适应画布", exact: true }).first().click().catch(() => {});
        const node = ctx.win.locator(`[data-node-id="${target.id}"]`).first();
        await node.click({ position: { x: 24, y: 24 }, timeout: 8_000 });
        const composer = ctx.win.locator(".generation-canvas-v2-node__composer");
        await composer.waitFor({ state: "visible", timeout: 8_000 });
        const parameterSummary = composer.locator('[data-parameter-summary]').first();
        await parameterSummary.click({ timeout: 8_000 });
        const modeOptions = ctx.win.locator('[data-agent-parameter-panel="true"] [role="radiogroup"]').first().locator('[role="radio"]');
        await modeOptions.first().waitFor({ state: "visible", timeout: 8_000 });
        // 空节点的产品 UI 会把「参考」显示为当前意图，但节点 meta 仍是 t2v；点「首帧」（图生视频）
        // 才真正走过一次用户的模式切换写口，而不是只读默认呈现。
        await modeOptions.nth(1).click();
        await ctx.win.keyboard.press("Escape");
        await waitForPersistedCanvas(ctx.win, ctx.projectDir, { settleMs: 500, timeoutMs: 8_000 });
        const addReference = composer.locator('[data-reference-add-entry="true"], [data-asset-add-tile="true"]').first();
        await addReference.click({ timeout: 8_000 });
        const picker = ctx.win.getByTestId("asset-picker");
        await picker.waitFor({ state: "visible", timeout: 8_000 });
        await picker.locator('input[type="file"][aria-label="上传本地文件"]').setInputFiles(realImage());
        await waitForPersistedCanvas(ctx.win, ctx.projectDir, { settleMs: 1_000, timeoutMs: 30_000 });
        await ctx.win.waitForTimeout(2_000);
      },
      verify(ctx) {
        const target = ctx.created().find((node) => node.kind === "video");
        const imageName = path.basename(realImage());
        const serializedMeta = JSON.stringify(target?.meta || {});
        const uploadedReferences = Array.isArray(target?.meta?.referenceImageUrls) ? target.meta.referenceImageUrls : [];
        const hasLocalReference = uploadedReferences.some((url) => String(url).startsWith("nomi-local://"));
        return [
          check("上传登记的 4K PNG 已复制进项目素材", containsFile(ctx.projectDir, imageName), `${ctx.projectDir}/${imageName}`, "outcome"),
          check("J4 冷打开耗时已记录", Number(JSON.parse(fs.readFileSync(path.join(ctx.projectDir, ".nomi", "real-media-cold-open.json"))).elapsedMs) >= 0, fs.readFileSync(path.join(ctx.projectDir, ".nomi", "real-media-cold-open.json"), "utf8"), "performance"),
          check("目标切到图生视频模式", target?.meta?.archetype?.modeId === "i2v", serializedMeta, "outcome"),
          check("目标节点 meta.referenceImageUrls 持久化本地图片参考", hasLocalReference, JSON.stringify({ referenceImageUrls: uploadedReferences }), "outcome"),
          check("上传后节点仍处于可生成参数状态", Boolean(target?.meta?.modelKey && Number(target?.meta?.duration) > 0), serializedMeta, "outcome"),
        ];
      },
    },
    {
      id: "reopen-reference",
      title: "冷重开项目并验证参考仍在",
      async act(ctx) {
        await backToLibrary(ctx.win);
        const card = ctx.win.locator('[data-project-card="true"]').first();
        await card.waitFor({ state: "visible", timeout: 8_000 });
        await card.click();
        await ctx.win.getByRole("button", { name: "生成", exact: true }).first().click();
        const target = ctx.created().find((node) => node.kind === "video");
        await ctx.win.locator(`[data-node-id="${target?.id}"]`).first().waitFor({ state: "visible", timeout: 8_000 });
        await ctx.win.locator(`[data-node-id="${target?.id}"]`).first().click({ position: { x: 24, y: 24 }, timeout: 8_000 });
        await ctx.win.locator(".generation-canvas-v2-node__composer").waitFor({ state: "visible", timeout: 8_000 });
        await waitForPersistedCanvas(ctx.win, ctx.projectDir, { settleMs: 500, timeoutMs: 8_000 });
      },
      verify(ctx) {
        const target = ctx.created().find((node) => node.kind === "video");
        const uploadedReferences = Array.isArray(target?.meta?.referenceImageUrls) ? target.meta.referenceImageUrls : [];
        return [
          check("冷重开后仍是图生视频模式", target?.meta?.archetype?.modeId === "i2v", JSON.stringify(target?.meta || {}), "outcome"),
          check("冷重开后参考图仍在目标节点 meta", uploadedReferences.some((url) => String(url).startsWith("nomi-local://")), JSON.stringify({ referenceImageUrls: uploadedReferences }), "outcome"),
        ];
      },
    },
  ],
};
