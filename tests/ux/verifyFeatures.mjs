// 功能地图里每个 `goto` 名字 → 走到那一屏的步骤（常驻驱动 ui-driver.mjs 用；地图正文在 .agents/skills/verify-nomi/features/）。
//
// 规矩（10-15 方向检查「外壳可达操作只有一个出口」）：这里**不写选择器**，每一步只调现成出口——
// `_shell.mjs`（外壳）、`_canvasHit.mjs`（画布落点）、`_creationResourceTree.mjs`（文稿树 / 分镜方案行的唯一入口）、
// `_modeMenu.mjs`（底栏方式格的唯一出口）。缺的出口补进 `_shell.mjs`。每个功能的 `exits` 列出它调到的出口，
// `verify-features.node-test.mjs` 核对：地图里写的名字都在这里、这里列的出口都真实存在、本文件没有自写选择器。
import * as shell from './_shell.mjs'
import * as creationTree from './_creationResourceTree.mjs'
import * as modeMenu from './_modeMenu.mjs'
import * as lab from './uiDriverLab.mjs'

export const EXIT_MODULES = Object.freeze({
  '_shell.mjs': shell,
  '_creationResourceTree.mjs': creationTree,
  '_modeMenu.mjs': modeMenu,
  'uiDriverLab.mjs': lab,
})

export const describeWhere = (win) => shell.describeShellLocation(win)

const localeOf = (ctx) => ctx.options.locale

/** 没在项目里就新建一个空白项目进去（像人一样点项目库的「新建」）；已在项目里什么也不做。 */
async function ensureProject(ctx) {
  await shell.closeSettings(ctx.win(), 'goto（先关掉开着的设置弹窗）')
  if (await shell.isInProject(ctx.win())) return
  await shell.createBlankProject(ctx.win())
}

async function ensureCanvas(ctx) {
  await ensureProject(ctx)
  await shell.switchWorkspace(ctx.win(), 'generation')
  await shell.switchGenerationView(ctx.win(), 'canvas')
}

/** 画布上有一个选中的节点（没有就从加节点条加一个），它的底栏露出来。kind 默认 image。 */
async function ensureSelectedNode(ctx, kind = 'image') {
  await ensureCanvas(ctx)
  await shell.collapseAgentPanel(ctx.win())
  await shell.selectOrAddCanvasNode(ctx.win(), kind)
}

export const FEATURES = {
  library: {
    summary: '项目库（新建 / 打开项目的地方）',
    exits: ['_shell.mjs#closeSettings', '_shell.mjs#leaveProjectIfOpen', '_shell.mjs#assertInLibrary'],
    async goto(ctx) {
      await shell.closeSettings(ctx.win(), 'goto library（先关掉开着的设置弹窗）')
      await shell.leaveProjectIfOpen(ctx.win(), 'goto library')
      await shell.assertInLibrary(ctx.win())
    },
  },
  storyboard: {
    summary: '创作页的分镜编辑器（镜头行 + 参考卡）；没有项目就新建一个（新项目自带一份空分镜方案）',
    exits: ['_shell.mjs#closeSettings', '_shell.mjs#isInProject', '_shell.mjs#createBlankProject', '_shell.mjs#switchWorkspace', '_creationResourceTree.mjs#openStoryboardEditor'],
    async goto(ctx) {
      await ensureProject(ctx)
      await shell.switchWorkspace(ctx.win(), 'creation')
      await creationTree.openStoryboardEditor(ctx.win(), { pick: 'first' }, 'goto storyboard')
    },
  },
  canvas: {
    summary: '生成画布（加节点条 + 左下缩放簇）',
    exits: ['_shell.mjs#isInProject', '_shell.mjs#createBlankProject', '_shell.mjs#switchWorkspace', '_shell.mjs#switchGenerationView'],
    async goto(ctx) {
      await ensureCanvas(ctx)
    },
  },
  'canvas-node': {
    summary: '画布上选中一个节点，露出它的底栏（参数：image | video | text，默认 image）',
    exits: ['_shell.mjs#collapseAgentPanel', '_shell.mjs#selectOrAddCanvasNode'],
    async goto(ctx) {
      await ensureSelectedNode(ctx, ctx.args[0] || 'image')
    },
  },
  params: {
    summary: '选中节点底栏的参数面板，展开高级设置（参数：image | video，默认 image）',
    exits: ['_shell.mjs#selectOrAddCanvasNode', '_shell.mjs#openNodeParams'],
    async goto(ctx) {
      await ensureSelectedNode(ctx, ctx.args[0] || 'image')
      await shell.openNodeParams(ctx.win())
    },
  },
  'model-menu': {
    summary: '选中节点底栏的模型菜单（参数：image | video，默认 image）',
    exits: ['_shell.mjs#selectOrAddCanvasNode', '_shell.mjs#openNodeModelMenu'],
    async goto(ctx) {
      await ensureSelectedNode(ctx, ctx.args[0] || 'image')
      await shell.openNodeModelMenu(ctx.win())
    },
  },
  'mode-menu': {
    summary: '选中视频节点底栏的方式菜单（文生 / 图生 / 首尾帧 / 全能参考）',
    exits: ['_shell.mjs#selectOrAddCanvasNode', '_shell.mjs#selectedNodeComposer', '_modeMenu.mjs#openModeMenu'],
    async goto(ctx) {
      await ensureSelectedNode(ctx, 'video')
      await modeMenu.openModeMenu(ctx.win(), shell.selectedNodeComposer(ctx.win()), localeOf(ctx))
    },
  },
  'model-settings': {
    summary: '设置弹窗的「模型」页签',
    exits: ['_shell.mjs#openModelSettings'],
    async goto(ctx) {
      await shell.openModelSettings(ctx.win(), { label: 'goto model-settings' })
    },
  },
  'agent-panel': {
    summary: 'Agent 面板展开（停靠 / 浮窗）',
    exits: ['_shell.mjs#isInProject', '_shell.mjs#createBlankProject', '_shell.mjs#ensureAgentPanelOpen'],
    async goto(ctx) {
      await ensureProject(ctx)
      await shell.ensureAgentPanelOpen(ctx.win(), 'goto agent-panel')
    },
  },
  'agent-collapsed': {
    summary: 'Agent 面板收起（收进顶栏最右的 Nomi 入口，窄窗时也一样）',
    exits: ['_shell.mjs#isInProject', '_shell.mjs#createBlankProject', '_shell.mjs#collapseAgentPanel'],
    async goto(ctx) {
      await ensureProject(ctx)
      await shell.ensureAgentPanelOpen(ctx.win(), 'goto agent-collapsed（先展开）')
      await shell.collapseAgentPanel(ctx.win(), 'goto agent-collapsed')
    },
  },
  'design-lab': {
    summary: '设计实验室某一屏（参数：<屏> [状态 id]；在仓库外的无头浏览器里开，之后的命令落在实验室页上）',
    lab: true,
    exits: ['uiDriverLab.mjs#openDesignLabScreen'],
    async goto(ctx) {
      const [screen, state] = ctx.args
      if (!screen) throw new Error('要点名一屏：goto design-lab <屏> [状态 id]（屏名见 src/devlab 的登记；例：storyboard）')
      await lab.openDesignLabScreen(ctx.surface, { screen, state, viewport: ctx.options.size, theme: ctx.options.theme })
    },
  },
}
