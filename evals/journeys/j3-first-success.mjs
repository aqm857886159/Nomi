import fs from "node:fs";
import { check } from "../lib/journeyRunner.mjs";
import { createBlankProject } from "../lib/isoApp.mjs";

export default {
  id: "j3-first-success",
  name: "新用户标准入口首次成功",
  needsAgent: false,
  smoke: true,
  successCriterion: "从空项目库创建项目，进入工作台并用当前空态入口创建第一个画面",
  async setup({ win, iso }) {
    return createBlankProject(win, iso.projectsDir);
  },
  milestones: [
    {
      id: "workbench-visible",
      title: "空白项目进入完整工作台",
      async act(ctx) {
        await ctx.win.getByRole("button", { name: "生成", exact: false }).first().click();
      },
      async verify(ctx) {
        const toolbar = await Promise.all(["创作", "生成", "预览", "导出"].map((name) => ctx.win.getByRole("button", { name, exact: false }).first().isVisible().catch(() => false)));
        return [
          check("项目已持久化", fs.existsSync(`${ctx.projectDir}/.nomi/project.json`), ctx.projectDir),
          check("四个工作区入口均可见", toolbar.every(Boolean), JSON.stringify(toolbar)),
          check("URL 带 projectId", /projectId=/.test(ctx.win.url()), ctx.win.url()),
        ];
      },
    },
    {
      id: "first-board",
      title: "通过当前生成空态创建第一个画面",
      async act(ctx) {
        const cta = ctx.win.getByText("新建画面", { exact: false }).first();
        if (await cta.count()) await cta.click();
      },
      async verify(ctx) {
        const emptyCtaVisible = await ctx.win.getByText("新建画面", { exact: false }).first().isVisible().catch(() => false);
        const canvasVisible = await ctx.win.locator(".generation-canvas-v2").first().isVisible().catch(() => false);
        return [check("创建后离开生成空态并显示画布", !emptyCtaVisible && canvasVisible, `empty=${emptyCtaVisible} canvas=${canvasVisible}`)];
      },
    },
  ],
};
