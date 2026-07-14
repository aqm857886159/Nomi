import { check } from "../lib/journeyRunner.mjs";
import { createBlankProject } from "../lib/isoApp.mjs";

export default {
  id: "j5-edit-export",
  name: "修改项目并进入导出",
  needsAgent: false,
  smoke: true,
  successCriterion: "创建并修改当前项目内容后进入导出工作区，导出控制面真实挂载",
  async setup({ win, iso }) {
    return createBlankProject(win, iso.projectsDir);
  },
  milestones: [
    {
      id: "modify-project",
      title: "在空项目中创建一个画面",
      async act(ctx) {
        await ctx.win.getByRole("button", { name: "生成", exact: false }).first().click();
        const cta = ctx.win.getByText("新建画面", { exact: false }).first();
        if (await cta.count()) await cta.click();
      },
      async verify(ctx) {
        const canvasVisible = await ctx.win.locator(".generation-canvas-v2").first().isVisible().catch(() => false);
        return [check("项目内容已从空态变为生成画布", canvasVisible, "generation canvas not visible")];
      },
    },
    {
      id: "open-export",
      title: "进入导出工作区",
      async act(ctx) {
        await ctx.win.getByRole("button", { name: "导出", exact: false }).first().click({ timeout: 5000 });
      },
      async verify(ctx) {
        const exportText = await ctx.win.getByText(/导出|输出文件|导出视频/, { exact: false }).count();
        const exportButton = ctx.win.getByRole("button", { name: "导出", exact: false }).first();
        const active = await exportButton.getAttribute("data-active").catch(() => null);
        return [check("导出工作区已挂载", exportText > 1 || active === "true", `matches=${exportText} active=${active}`)];
      },
    },
  ],
};
