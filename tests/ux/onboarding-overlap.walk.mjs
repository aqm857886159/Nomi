// F4 走查（2026-08-25「预算焦虑短剧创作者」真机走查抓出）：上手清单下拉不得盖住创作区右侧
// 「拆成镜头·落画布」按钮并吞掉点击。
//
// 现场：清单面板（OnboardingChecklist，挂 NomiAppBar 右簇，fixed z-[180]）此前**开屏就自动展开**，
// 完全盖住选中文字后 AI 面板顶部的 [data-action-run="storyboard"]；用户照引导去点 → 点击被引导第三步
// 拦截到超时 → 以为产品坏了。根因：违反设计系统 §1.5.3「动作不许压在内容上」。
//
// 修法（本走查验的两件事）：
//   ① 清单默认收起——入口 pill（N/4）仍常驻顶栏可见，但不再摊开盖住工作区；
//   ② 用户一开始工作（编辑器聚焦/选中）→ 即使展开也自动让开。
//
// 断言用 _assert.mjs 的 proveProbe/expectAbsent 体系（遮挡检测带**阳性对照**）：
//   · 先证「探针测得到遮挡」——手动点开清单，证明此时 elementFromPoint(按钮中心) 命中的是清单面板
//     （proveProbe 拿到证明：occlusionDetectable）；
//   · 再切回默认态，断言按钮中心点命中的是按钮自身/其子元素、**不是**清单面板（expectAbsent 引用该证明）。
// 没有阳性对照的「没遮挡」是恒真空话——按钮没渲染出来时 elementFromPoint 也不会命中面板（_assert.mjs 头注）。
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectVisible, proveProbe, expectAbsent, expect, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-onboarding-overlap-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/onboarding-overlap')
const projectId = 'onboarding-overlap'
const projectRoot = path.join(projectsDir, `onboarding-overlap-${projectId}`)

fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

// 故事正文 ≥ 60 字：StoryboardNudge 达阈值即**确定性**浮出「拆成镜头·落画布」卡（无需真模型/额度）。
const STORY =
  '林小满攥着房租催缴单站在便利店门口，冷风灌进领口。她数了数口袋里的硬币，还差三百块。' +
  '手机在这时震动，是房东发来的最后通牒。她深吸一口气，转身走进夜色里——这一夜必须想出办法。'

const project = {
  id: projectId,
  name: '上手清单遮挡回归',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocument: {
      version: 1,
      title: '遮挡回归',
      contentJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: STORY }] }],
      },
      updatedAt: 1,
    },
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null,
    storyboardPlanCommitted: false,
  },
}

for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}

const { app, win } = await launchNomiApp({
  name: 'onboarding-overlap',
  tempRoot,
  settingsDir,
  projectsDir,
  settleMs: 1400,
})

async function closeApp() {
  const child = app.process()
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  if (child && child.exitCode === null) child.kill('SIGKILL')
}

// 只关开屏动画/引导旅途（splash/journey-tour/gesture-hint）——**不**碰清单折叠态，
// 让「首启默认收起」这条修复在真实默认下被验证（清了折叠态才能证明 absent 那侧是默认行为）。
async function dismissIntro() {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
    // 折叠态清掉：确保测的是「首启默认」而非上一次残留。
    localStorage.removeItem('nomi:checklist-collapsed:v1')
    localStorage.removeItem('nomi:checklist-dismissed:v1')
    localStorage.removeItem('nomi:checklist-first-shown:v1')
  })
  // 冷启：关掉再重开窗口（不用 win.reload()——原地刷新会让 getActiveWorkbenchProjectId 恒 null，
  // 面板静默空掉像极了真 bug，见记忆 walkthrough-no-win-reload）。这里用轻量做法：重进库页即可，
  // 因为我们随后就打开项目，项目会重新水合。
}

async function openCreationWorkspace() {
  const card = win.locator('[data-project-card]', { hasText: project.name }).first()
  await card.waitFor({ state: 'visible', timeout: 6000 })
  await card.hover()
  const continueButton = card.getByText('继续创作', { exact: false }).first()
  if ((await continueButton.count()) > 0) await continueButton.click()
  else await card.dblclick()
  // 打开项目后默认落「生成」画布（S5 canvas landing）——切到「创作」工作区（NomiStepper）。
  // 用 clickOrFail：点不到就报红，不静默跳过（否则后面等创作区会超时、线索反而被埋）。
  const creationTab = win.getByRole('button', { name: '创作', exact: true })
  await clickOrFail(creationTab, '顶栏「创作」步骤器', { timeout: 8000 })
  await win.getByLabel('创作区', { exact: true }).waitFor({ state: 'visible', timeout: 8000 })
}

// 命中检测：storyboard 按钮中心点，elementFromPoint 命中谁？clear=命中按钮自身/其子；
// occludedByChecklist=命中的东西落在清单面板子树里。
async function hitTestStoryboardButton() {
  const btn = win.locator('[data-action-run="storyboard"]').first()
  await btn.waitFor({ state: 'visible', timeout: 8000 })
  return btn.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const hit = document.elementFromPoint(cx, cy)
    const panel = hit ? hit.closest('[data-onboarding-checklist="panel"]') : null
    return {
      clear: hit === element || Boolean(hit && element.contains(hit)),
      occludedByChecklist: Boolean(panel),
      center: { x: Math.round(cx), y: Math.round(cy) },
      buttonRect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      hitLabel:
        hit?.getAttribute('data-action-run') ||
        hit?.getAttribute('aria-label') ||
        hit?.textContent?.trim().slice(0, 32) ||
        hit?.tagName ||
        'none',
    }
  })
}

try {
  await dismissIntro()
  await openCreationWorkspace()

  // 选中一段文字（模拟用户「全选 → 拆成镜头」），StoryboardNudge 已因故事≥60字浮出按钮。
  const editor = win.getByLabel('创作区', { exact: true })
  await editor.click()
  await win.keyboard.press('Control+A').catch(() => {})

  const storyboardBtn = win.locator('[data-action-run="storyboard"]').first()
  await expectVisible(storyboardBtn, '选中文字后「拆成镜头·落画布」按钮应出现（StoryboardNudge 达阈值浮出）')
  await screenshotSettled(win, { path: path.join(shotsDir, '01-default-button-visible.png') })

  // —— 阳性对照：手动点开清单，证明「遮挡确实测得到」——
  // 先记录默认态下清单入口 pill 存在（清单没被 dismiss、确实挂着）。
  const trigger = win.locator('[data-onboarding-checklist-trigger="true"]').first()
  await expectVisible(trigger, '顶栏应有上手清单入口 pill（清单挂着、只是默认收起）')
  await trigger.click()
  const panel = win.locator('[data-onboarding-checklist="panel"]').first()
  await expectVisible(panel, '点开后清单面板应展开')
  await screenshotSettled(win, { path: path.join(shotsDir, '02-checklist-opened-occludes.png') })

  // 证明：此时按钮中心点被清单面板遮挡（探针测得到「遮挡」这个信号）。
  const occluded = await hitTestStoryboardButton()
  console.log('  [positive-control] opened checklist hitTest:', JSON.stringify(occluded))
  expect(
    occluded.occludedByChecklist,
    `阳性对照失败：手动点开清单后，按钮中心点本应被清单面板遮挡，但 elementFromPoint 命中了「${occluded.hitLabel}」。\n`
      + '若这里都测不到遮挡，下面「默认态不遮挡」的断言就是恒真空话。',
  ).toBe(true)
  const occlusionDetectable = await proveProbe(panel, '清单展开时其面板确实覆盖到按钮中心（遮挡可被 elementFromPoint 测到）')

  // —— 回默认态：收起清单，断言按钮不再被遮挡、且点得着 ——
  await trigger.click() // 再点一次收起
  await expectAbsent(panel, {
    provenBy: occlusionDetectable,
    message: '收起后清单面板不该再存在于按钮上方',
  })

  const clear = await hitTestStoryboardButton()
  console.log('  [default] collapsed hitTest:', JSON.stringify(clear))
  expect(
    clear.clear && !clear.occludedByChecklist,
    `默认态遮挡回归：「拆成镜头·落画布」按钮中心点被「${clear.hitLabel}」挡住了（应命中按钮自身）。\n`
      + 'F4 根因：上手清单 fixed 覆盖层盖住创作区右侧工作按钮并吞点击。',
  ).toBe(true)
  await screenshotSettled(win, { path: path.join(shotsDir, '03-collapsed-button-clear.png') })

  // 真点一次：点得到 = 覆盖层没吞点击（clickOrFail 点不到会报红，不静默跳过）。
  await clickOrFail(storyboardBtn, '拆成镜头·落画布', { timeout: 8000 })
  await screenshotSettled(win, { path: path.join(shotsDir, '04-clicked.png') })

  console.log('✅ F4 通过：上手清单默认收起、不遮挡「拆成镜头·落画布」，按钮点得着。')
  await closeApp()
} catch (error) {
  console.error(error)
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  await closeApp()
  process.exit(1)
}
