// J5 修改旧节点并导出。零额度、不调 AI。
// 成功标准(CLAUDE.md):打开项目→找到节点→改 prompt(真持久化)→导出面板可达。
import { check } from "../lib/journeyRunner.mjs";
import { createBlankProject } from "../lib/isoApp.mjs";

const MARK = "J5 回归提示词标记";

export default {
  id: "j5-edit-export",
  name: "修改旧节点并导出",
  needsAgent: false,
  successCriterion: "改节点 prompt 真持久化进 project.json → 导出面板可达且有导出语义",
  async setup({ win, iso }) {
    return createBlankProject(win, iso.projectsDir);
  },
  milestones: [
    {
      id: "edit-node-prompt",
      title: "改默认节点 prompt 并真实持久化",
      async act(ctx) {
        // 空白项目默认落「创作」标签;节点在「生成」画布里——先切到生成工作区。
        await ctx.win.getByRole("button", { name: "生成", exact: true }).first().click({ timeout: 5000 });
        await ctx.win.waitForTimeout(1200);
        // 画布自管指针事件,locator.click 被拦——用坐标点节点中心选中。
        const box = await ctx.win.evaluate(() => {
          const el = [...document.querySelectorAll("div")].find(
            (d) => d.textContent?.includes("关键画面") && d.getBoundingClientRect().width > 100 && d.getBoundingClientRect().width < 600,
          );
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        if (!box) throw new Error("空白项目画布未见默认节点");
        await ctx.win.mouse.click(box.x, box.y);
        await ctx.win.waitForTimeout(1000);
        // 节点自带的提示词编辑器(区别于创作区的 workbench-editor__content,后者在生成标签下隐藏但仍在 DOM)。
        const promptBox = ctx.win.locator(".generation-canvas-v2-node__prompt-input").first();
        await promptBox.waitFor({ state: "visible", timeout: 8000 });
        await promptBox.click();
        await promptBox.fill(`${MARK} ${Date.now()}`);
        await ctx.win.waitForTimeout(1500); // 等持久化 debounce
      },
      async verify(ctx) {
        const deadline = Date.now() + 10_000;
        let persisted = false;
        while (Date.now() < deadline && !persisted) {
          const nodes = ctx.nodes();
          persisted = JSON.stringify(nodes).includes(MARK);
          if (!persisted) await ctx.win.waitForTimeout(700);
        }
        return [check("改 prompt 真实持久化进 project.json(终态取证)", persisted, "", "outcome")];
      },
    },
    {
      id: "export-reachable",
      title: "导出面板可达且有导出语义",
      async act(ctx) {
        await ctx.win.locator('[aria-label="前往预览导出"]').first().click({ timeout: 5000 });
        await ctx.win.waitForTimeout(1500);
      },
      async verify(ctx) {
        const bodyText = await ctx.win.evaluate(() => document.body.innerText);
        return [check("导出面板可达且有导出语义内容(导出/MP4/分辨率)", /导出|MP4|分辨率/.test(bodyText), "", "reachability")];
      },
    },
  ],
};
