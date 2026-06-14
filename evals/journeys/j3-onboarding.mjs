// J3 新用户 30 秒上手(冷启动)。零额度、不调 AI。
// 成功标准(CLAUDE.md):首页点示例→自动创建项目→画布展开→能看到工作台三标签→创作区有内容。
import fs from "node:fs";
import path from "node:path";
import { check } from "../lib/journeyRunner.mjs";

function singleProjectDir(projectsDir) {
  if (!fs.existsSync(projectsDir)) return null;
  const dirs = fs.readdirSync(projectsDir).filter((n) => fs.existsSync(path.join(projectsDir, n, ".nomi", "project.json")));
  return dirs.length === 1 ? path.join(projectsDir, dirs[0]) : null;
}

export default {
  id: "j3-onboarding",
  name: "新用户 30 秒上手",
  needsAgent: false,
  successCriterion: "首页点示例 → 项目自动创建落盘 → 工作台三标签可见 → 创作区有内容",
  async setup({ win, iso }) {
    // 冷启动 CTA(Onboarding v3):起始页「30 秒体验」一键创建示例项目并进工作台。
    const example = win.getByText("30 秒体验", { exact: false }).first();
    await example.waitFor({ timeout: 10_000 });
    await example.click();
    const deadline = Date.now() + 12_000;
    let projectDir = null;
    while (Date.now() < deadline && !projectDir) {
      projectDir = singleProjectDir(iso.projectsDir);
      if (!projectDir) await win.waitForTimeout(600);
    }
    if (!projectDir) throw new Error("点示例后项目未落盘");
    await win.waitForTimeout(1500);
    return projectDir;
  },
  milestones: [
    {
      id: "workbench-ready",
      title: "工作台展开、三标签可见、创作区有内容",
      async verify(ctx) {
        const urlHasProject = /projectId=/.test(ctx.win.url());
        const tabs = {};
        for (const name of ["创作", "生成", "预览"]) {
          tabs[name] = await ctx.win.getByRole("button", { name, exact: false }).first().isVisible().catch(() => false);
        }
        const bodyLen = await ctx.win.evaluate(() => document.body.innerText.length);
        return [
          check("工作台 URL 带 projectId(prod hash 路由回归锁)", urlHasProject, ctx.win.url(), "reachability"),
          check("「创作」标签可见", tabs["创作"], "", "reachability"),
          check("「生成」标签可见", tabs["生成"], "", "reachability"),
          check("「预览」标签可见", tabs["预览"], "", "reachability"),
          check("创作区有示例文案内容(非空白)", bodyLen > 200, `bodyLen=${bodyLen}`, "outcome"),
        ];
      },
    },
  ],
};
