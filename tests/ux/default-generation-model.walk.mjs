// R16 真实用户任务：「我不想每开一张新卡都重选模型」（用户 2026-08-18 看样张后拍板的功能）。
//
// 任务闭环：进设置 → AI 策略 → 给「文生图」设一个默认模型 → 回画布新建一张图片卡
//        → 这张卡开出来就是那个模型（而不是池子里第一个健康的）。
//
// 判据是**卡片真实选中的模型**，不是截图好不好看。
// 反向对照同样重要：没设默认时新卡走原有策略，不能因为这功能把没设过的人也改了行为。
//
// 真 Electron + 真构建产物，隔离 userData / projects，全程不发生成请求（零额度）。
// 用法：pnpm run build && node tests/ux/default-generation-model.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, clickOrFail, screenshotSettled } from './_assert.mjs'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/default-generation-model')
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nomi-default-model-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
mkdirSync(projectsDir, { recursive: true })
mkdirSync(shotsDir, { recursive: true })

const { app, win: initialWin } = await launchNomiApp({
  name: 'default-generation-model',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
  syntheticCredentialStorage: true,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let passed = 0
function assert(condition, label, detail = '') {
  if (!condition) throw new Error(`WALK FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  passed += 1
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

let win = initialWin
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || win
  return win
}

const snap = async (name) => {
  await screenshotSettled(getWin(), { path: path.join(shotsDir, name) })
  console.log(`  · 截图 ${name}`)
}

async function dismissFirstRun() {
  for (let index = 0; index < 6; index += 1) {
    const action = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

async function resize(width, height) {
  const browserWindow = await app.browserWindow(getWin())
  await browserWindow.evaluate((target, size) => {
    target.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
    target.center()
  }, { width, height })
  await getWin().waitForTimeout(350)
}

/**
 * 读**当前选中**那张卡的模型。
 * 模型芯片住在浮动 composer 里、不在节点元素内，所以只有选中的那张读得到——
 * 想比对另一张就得先选中它（第一版走查在这里读了个空，把「没被改写」误判成失败）。
 */
const readSelectedModel = () => getWin().evaluate(() => {
  const trigger = document.querySelector('[aria-label="模型"]')
  return trigger ? (trigger.textContent || '').trim() : null
})

/** 选中第 index 张卡（点它的标题条，避开内容区的拖拽/上传热区）。 */
async function selectCard(index) {
  const node = getWin().locator('.generation-canvas-v2-node').nth(index)
  await node.click({ position: { x: 40, y: 10 }, timeout: 8000 })
  await getWin().waitForTimeout(700)
}

/** 直接读设置文件落盘结果，证明偏好真的持久化了（不是只活在内存）。 */
const readPersistedDefaults = () => getWin().evaluate(
  () => window.nomiDesktop?.settings?.generationModelDefaults?.get?.(),
)

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  await dismissFirstRun()

  // 占位 key：让内置图片模型出现在目录里（全程不点生成、零额度）。
  await getWin().evaluate(() =>
    window.nomiDesktop?.modelCatalog?.upsertVendorApiKey('kie', { apiKey: 'nomi-e2e-placeholder', enabled: true }),
  )
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  await dismissFirstRun()
  await resize(1500, 1000)

  const blankProject = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  await blankProject.waitFor({ timeout: 8000 })
  await blankProject.click()
  await getWin().waitForTimeout(2200)
  await dismissFirstRun()

  // ── 反向对照：没设默认时，新卡走原有策略 ─────────────────────────────
  const generation = getWin().getByRole('button', { name: '生成', exact: true }).first()
  await generation.waitFor({ timeout: 8000 })
  await generation.click()
  await getWin().locator('.generation-canvas-v2-toolbar').waitFor({ timeout: 8000 })
  await clickOrFail(getWin().locator('.generation-canvas-v2-toolbar button').nth(1), '工具条上的「图片」')
  await getWin().waitForTimeout(1400)

  const baseline = await readSelectedModel()
  assert(Boolean(baseline), '没设默认时新卡也选出了模型（原有策略仍生效）', String(baseline))
  await snap('01-baseline-card.png')

  // ── 进设置给「文生图」设一个默认模型 ──────────────────────────────────
  await clickOrFail(getWin().locator('[aria-label*="设置"], button[title*="设置"]').first(), '顶栏设置')
  await getWin().waitForTimeout(900)
  await clickOrFail(getWin().locator('[data-settings-tab-id="ai"]').first(), 'AI 策略 tab')
  await getWin().waitForTimeout(700)

  const section = getWin().locator('[data-settings-section="default-generation-models"]')
  await expectVisible(section, '「新建卡片默认模型」区块出现')
  passed += 1
  console.log('  ✓ 「新建卡片默认模型」区块出现')
  await snap('02-settings-section.png')

  await clickOrFail(section.locator('[aria-label="文生图 默认模型"]'), '文生图 默认模型下拉')
  await getWin().waitForTimeout(400)

  // 挑一个**不是**基线的选项，这样「默认生效了」才可证伪。
  // 必须只看**可见**的 option：Mantine 的下拉挂在 body 的 portal 里，画布上那些没展开的
  // 下拉（变体张数等）其选项也在 DOM 中——用裸 querySelectorAll 会挑到「1 张」这种货
  // （本走查第一次跑就是这么错的）。
  const visibleOptions = getWin().locator('[role="option"]:visible')
  const optionTexts = (await visibleOptions.allTextContents()).map((text) => text.trim())
  const targetIndex = optionTexts.findIndex(
    (text) => text && text !== '自动选择' && !text.startsWith(baseline),
  )
  assert(targetIndex >= 0, '下拉里有可选的模型', JSON.stringify(optionTexts))
  const picked = optionTexts[targetIndex]
  await visibleOptions.nth(targetIndex).click({ timeout: 5000 })
  assert(Boolean(picked), '选到了一个与基线不同的模型（否则这条走查证明不了任何事）', String(picked))
  await getWin().waitForTimeout(700)
  await snap('03-default-picked.png')

  const persisted = await readPersistedDefaults()
  const entry = persisted?.byTaskKind?.text_to_image
  assert(
    Boolean(entry?.vendorKey && entry?.modelKey),
    '偏好以「供应商 + 模型」两段身份落盘（只存模型名会跨供应商串台）',
    JSON.stringify(entry),
  )

  // ── 回画布新建一张图片卡：必须开成刚设的那个模型 ───────────────────────
  await getWin().keyboard.press('Escape')
  await getWin().waitForTimeout(700)
  await clickOrFail(getWin().locator('.generation-canvas-v2-toolbar button').nth(1), '工具条上的「图片」')
  // 等「第二张卡出现」这个**事实**，而不是睡一个够长的觉——真实耗时会变，
  // sleep 不够长时读到的是 1 张，断言反而会把「还没渲染」当成「功能坏了」。
  await getWin().locator('.generation-canvas-v2-node').nth(1).waitFor({ state: 'visible', timeout: 15_000 })
  // 模型芯片是异步挑出来的：等它有内容，否则读到空串。
  await getWin().locator('[aria-label="模型"]').filter({ hasNotText: /^$/ }).first()
    .waitFor({ state: 'visible', timeout: 15_000 })

  const cardCount = await getWin().locator('.generation-canvas-v2-node').count()
  assert(cardCount === 2, '画布上确实有两张卡（基线一张 + 新建一张）', String(cardCount))

  const newest = await readSelectedModel()
  await snap('04-new-card-inherits.png')
  assert(
    Boolean(newest) && picked.startsWith(newest),
    '新建的卡片继承了设置里的默认模型',
    `新卡是「${newest}」，设的是「${picked}」`,
  )

  // 回头选中第一张：它必须还是基线模型。这一条是「只影响新建的」的唯一硬证据。
  await selectCard(0)
  const firstAfter = await readSelectedModel()
  await snap('05-existing-card-untouched.png')
  assert(
    firstAfter === baseline,
    '已有卡片没有被批量改写（只影响新建的）',
    `第一张现在是「${firstAfter}」，基线是「${baseline}」`,
  )

  console.log(`\n✅ 走查通过：${passed} 条判据`)
} finally {
  await app.close().catch(() => {})
}
