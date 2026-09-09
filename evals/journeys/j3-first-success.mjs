import fs from "node:fs";
import path from "node:path";
import { check } from "../lib/journeyRunner.mjs";
import { dismissSplashIfPresent } from "../lib/isoApp.mjs";

async function waitForSingleProject(win, projectsDir) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const dirs = fs.existsSync(projectsDir)
      ? fs.readdirSync(projectsDir).filter((name) => fs.existsSync(path.join(projectsDir, name, ".nomi", "project.json")))
      : [];
    if (dirs.length === 1) return path.join(projectsDir, dirs[0]);
    await win.waitForTimeout(250);
  }
  throw new Error("60 秒引导未创建示例项目");
}

export default {
  id: "j3-first-success",
  name: "新用户标准入口首次成功",
  needsAgent: false,
  smoke: true,
  successCriterion: "从空项目库启动 60 秒引导，看懂画布卡片并能点开节点查看参数",
  async setup({ win, iso }) {
    await dismissSplashIfPresent(win);
    await win.getByText("看 Nomi 怎么出片", { exact: false }).first().click({ timeout: 10_000 });
    return waitForSingleProject(win, iso.projectsDir);
  },
  milestones: [
    {
      id: "guided-canvas",
      title: "引导自动铺开真实画布并解释卡片",
      async act(ctx) {
        await ctx.win.locator('[data-onboarding-spotlight-callout="true"]').waitFor({ state: "visible", timeout: 60_000 });
        await ctx.win.locator(".generation-canvas-v2-node").first().waitFor({ state: "visible", timeout: 15_000 });
      },
      async verify(ctx) {
        const callout = (await ctx.win.locator('[data-onboarding-spotlight-callout="true"]').innerText()).replace(/\s+/g, " ");
        const nodeCount = await ctx.win.locator(".generation-canvas-v2-node").count();
        return [
          check("项目已持久化", fs.existsSync(`${ctx.projectDir}/.nomi/project.json`), ctx.projectDir),
          check("URL 带 projectId", /projectId=/.test(ctx.win.url()), ctx.win.url()),
          check("引导已自动铺开画布", nodeCount >= 3, `nodes=${nodeCount}`),
          check("引导解释了角色卡/镜头卡用途", /同一个人|身份卡|镜头|卡/.test(callout), callout),
        ];
      },
    },
    {
      id: "inspect-node",
      title: "退出引导后亲手点开一个节点查看参数",
      async act(ctx) {
        const callout = ctx.win.locator('[data-onboarding-spotlight-callout="true"]');
        await callout.getByRole("button", { name: "跳过", exact: true }).click();
        const finale = ctx.win.locator('[data-journey-tour="finale"]');
        await finale.waitFor({ state: "visible", timeout: 5_000 });
        await finale.getByRole("button", { name: "先逛逛", exact: true }).click();
        await ctx.win.getByRole("button", { name: "生成", exact: true }).first().click().catch(() => {});
        await ctx.win.getByRole("button", { name: "适应画布", exact: true }).first().click().catch(() => {});
        // The storyboard table is also a canvas node; inspect a shot with generation parameters.
        const node = ctx.win.locator('.generation-canvas-v2-node[data-kind="video"]').first();
        await node.click({ position: { x: 24, y: 24 } });
        await ctx.win.locator(".generation-canvas-v2-node__composer").waitFor({ state: "visible", timeout: 8_000 });
      },
      async verify(ctx) {
        const composer = ctx.win.locator(".generation-canvas-v2-node__composer");
        const promptVisible = await composer.locator(".generation-canvas-v2-node__prompt-input").isVisible().catch(() => false);
        const modelVisible = await composer.locator('[aria-label="模型"]').first().isVisible().catch(() => false);
        return [
          check("点节点后参数编辑器可见", await composer.isVisible().catch(() => false)),
          check("节点提示词可查看", promptVisible),
          check("节点模型参数可查看", modelVisible),
        ];
      },
    },
  ],
};
