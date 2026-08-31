// F6 + F5 走查（2026-08-25「预算焦虑短剧创作者」真机走查抓出）：
//   F6 上手清单第一步「接入模型」的绿勾不得撒谎——key 记录在、但本机解不开（locked）时不得打勾。
//   F5 拆镜头缺可用文本大脑时，不得把英文原串直通用户（走 recovery 卡人话）。
//
// 现场根因（同一处判据错位）：hasApiKey = 密文字节还在（不证解得开）。旧 useHasTextModel 只看
// 「catalog 有 enabled 的 text 模型」→ locked 也打勾 / 也不出恢复卡 → 用户拆镜头撞
// 「No local text model is configured…」半中半英散句。修法：useHasTextModel 改用真实可用性
// （getTextBrain → chooseTextModel，解不出 key 就为 false）；错误 code 化 + classifyError 人话化。
//
// 种一个 **locked** 现场：enc=safeStorage 但密文是垃圾 base64 → decryptApiKeyRecord 抛错吐空串
// → apiKeyDecryptStatus=locked（无论本机 safeStorage 是否可用都成立，见 secrets.ts）。text 模型 enabled，
// 于是「catalog 有 enabled text 模型」为真、「真能用」为假——正是走查现场。
//
// 断言：① 第一步 [data-step="model"][data-done="false"]（不打勾）；② 拆镜头报错走 recovery 卡而非英文原串。
// 阳性对照（proveProbe）：先证清单面板 + 四个步骤项确实渲染出来（探针活着），否则 data-done 断言是空话。
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectVisible, proveProbe, expect, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-checkmark-honesty-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/onboarding-checkmark-honesty')
const projectId = 'checkmark-honesty'
const projectRoot = path.join(projectsDir, `checkmark-honesty-${projectId}`)

fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

const now = '2026-08-25T00:00:00.000Z'
const vendorKey = 'api-locked-vendor'
// 运行时造「垃圾密文」——不写死 base64 字面量（那会被密钥扫描门岗当成明文凭证误报）。
// 这不是任何真 key：只是随便一段字节的 base64，标了 enc=safeStorage → decryptApiKeyRecord 解不开
// → "" → apiKeyDecryptStatus=locked（key 记录**在**但读不动）。这正是走查现场的 locked 态。
const LOCKED_GARBAGE_CIPHER = Buffer.from('nomi-walkthrough-not-a-real-cipher').toString('base64')
// enc=safeStorage + 垃圾密文：decryptApiKeyRecord 解不开 → "" → keyStatus=locked（key 记录**在**但读不动）。
fs.writeFileSync(
  path.join(settingsDir, 'model-catalog.json'),
  JSON.stringify(
    {
      version: 1,
      vendors: [
        {
          key: vendorKey,
          name: 'Locked Vendor',
          enabled: true,
          baseUrlHint: 'https://api.example.com/v1',
          authType: 'bearer',
          providerKind: 'openai-compatible',
          meta: {},
          createdAt: now,
          updatedAt: now,
        },
      ],
      models: [
        {
          vendorKey,
          modelKey: 'locked-text-4',
          labelZh: 'locked-text-4',
          kind: 'text',
          enabled: true,
          createdAt: now,
          updatedAt: now,
          meta: {},
        },
      ],
      mappings: [],
      apiKeysByVendor: {
        [vendorKey]: {
          vendorKey,
          apiKey: LOCKED_GARBAGE_CIPHER,
          enc: 'safeStorage',
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    },
    null,
    2,
  ),
)

const STORY =
  '林小满攥着房租催缴单站在便利店门口，冷风灌进领口。她数了数口袋里的硬币，还差三百块。' +
  '手机在这时震动，是房东发来的最后通牒。她深吸一口气，转身走进夜色里——这一夜必须想出办法。'

const project = {
  id: projectId,
  name: '绿勾诚实回归',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocument: {
      version: 1,
      title: '绿勾诚实',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: STORY }] }] },
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
  name: 'checkmark-honesty',
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

async function dismissIntro() {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
    localStorage.removeItem('nomi:checklist-collapsed:v1')
    localStorage.removeItem('nomi:checklist-dismissed:v1')
  })
}

async function openCreationWorkspace() {
  const card = win.locator('[data-project-card]', { hasText: project.name }).first()
  await card.waitFor({ state: 'visible', timeout: 6000 })
  await card.hover()
  const continueButton = card.getByText('继续创作', { exact: false }).first()
  if ((await continueButton.count()) > 0) await continueButton.click()
  else await card.dblclick()
  const creationTab = win.getByRole('button', { name: '创作', exact: true })
  await clickOrFail(creationTab, '顶栏「创作」步骤器', { timeout: 8000 })
  await win.getByLabel('创作区', { exact: true }).waitFor({ state: 'visible', timeout: 8000 })
}

try {
  await dismissIntro()
  await openCreationWorkspace()

  // —— F6：打开上手清单，断言第一步「接入模型」**没打勾**（key locked，真实不可用）——
  const trigger = win.locator('[data-onboarding-checklist-trigger="true"]').first()
  await clickOrFail(trigger, '上手清单入口 pill', { timeout: 8000 })
  const panel = win.locator('[data-onboarding-checklist="panel"]').first()
  await expectVisible(panel, '清单面板应展开')
  await screenshotSettled(win, { path: path.join(shotsDir, '01-checklist-open.png') })

  // 阳性对照：四个步骤项确实渲染（探针活着）——否则下面 data-done 断言是空话。
  const stepItems = panel.locator('li[data-step]')
  await proveProbe(stepItems, '清单四步项确实渲染出来（data-step 探针活着）')

  const modelStep = panel.locator('li[data-step="model"]').first()
  await expectVisible(modelStep, '第一步「接入模型」应在清单里')
  const modelDone = await modelStep.getAttribute('data-done')
  console.log('  [F6] 第一步 data-done =', modelDone)
  expect(
    modelDone,
    'F6 绿勾撒谎：key 记录在但本机解不开（locked）时，第一步「接入模型」不该打勾——'
      + '真实拆镜头会失败，勾却是绿的（2026-08-25 走查）。',
  ).toBe('false')

  // 收起清单让开工作区（也顺带验 F4 的收起不挡按钮，两条修复同屏）。
  await trigger.click()

  // —— F5：点「拆成镜头·落画布」→ 因缺可用大脑失败，断言走 recovery 卡、**不含**英文原串 ——
  const storyboardBtn = win.locator('[data-action-run="storyboard"]').first()
  await clickOrFail(storyboardBtn, '拆成镜头·落画布', { timeout: 8000 })

  // 缺大脑是**确定性**失败（不发网络请求，chooseTextModel 直接抛）——很快落终态。
  // recovery 卡锚点：data-recovery="no-text-model"；错误卡锚点：data-assistant-error。
  const recovery = win.locator('[data-recovery="no-text-model"]').first()
  const errorCard = win.locator('[data-assistant-error="true"]').first()
  // 等两者之一出现（都算「错误态被人话化的卡」，而不是原始英文串裸奔）。
  await expect
    .poll(
      async () => ((await recovery.count()) > 0 ? 'recovery' : (await errorCard.count()) > 0 ? 'errorcard' : 'none'),
      { timeout: 30_000, message: '拆镜头失败后应出现 recovery 卡或错误卡（人话化），而不是原始英文串' },
    )
    .not.toBe('none')
  await screenshotSettled(win, { path: path.join(shotsDir, '02-storyboard-error.png') })

  // 关键（正向锚定，别读空区域制造假绿）：从**实际渲染出来的那张卡**读文本——它必然非空、且必含人话，
  // 断言这段人话里**不含**英文原串（F5 根因就是这句被直通）。读卡本身而非「消息区容器」，
  // recovery 卡不一定挂在对话流里（实测它挂在助手面板另一处）。
  const card = (await recovery.count()) > 0 ? recovery : errorCard
  const cardText = (await card.innerText()).replace(/\s+/g, ' ').trim()
  console.log('  [F5] 错误卡文本:', cardText.slice(0, 240))
  // 正向证据：卡里必有人话（非空、且是中文引导），证明我们确实读到了那张卡、不是空区域。
  expect(cardText.length, 'F5 探针失效：读到的错误卡文本为空——断言可能是空过（读错了元素）').toBeGreaterThan(8)
  expect(
    cardText.includes('No local text model') || cardText.includes('Open model settings'),
    `F5 英文原串直通：错误卡文案里出现了服务端英文散句。\n实际文本：${cardText.slice(0, 240)}`,
  ).toBe(false)

  console.log('✅ F6+F5 通过：locked key 下第一步不打勾、拆镜头错误走人话卡不甩英文串。')
  await closeApp()
} catch (error) {
  console.error(error)
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  await closeApp()
  process.exit(1)
}
