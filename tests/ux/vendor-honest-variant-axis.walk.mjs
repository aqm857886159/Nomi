// 穿透走查（规则 13）—— 「变体轴按渠道收窄」+「提案面板与画布同一套收窄」，**零额度**（全程不点生成）。
//
// ── 这份走查在证什么 ────────────────────────────────────────────────────────
//
// 变体（型号）的意义只有一个：**换一个真正发出去的 model 串**。档案里 `variant.modelKey` 就是那个串，
// 它要生效，渠道的 create op 必须把 model 字段**参数化**成 `{{request.params.model}}`。Runway 把 model
// 写成字面量——切变体什么也不会发生，控件摆在那儿纯属骗用户（点了没反应，比没有更糟）。所以收窄后
// Runway 整条变体选择器不显示。
//
// Runway 之所以敢写死，是因为它把 veo3.1 与 veo3.1_fast 建成**两个目录行**，本就不需要变体轴。
//
// ── 为什么判据不能是「变体的 modelKey 在目录里有没有对应行」───────────────
//
// APIMart 的 veo 只有 `veo3.1-fast` 一行，quality/lite 根本不是独立行。按那个判据会把 APIMart 活着的
// 变体轴一起藏掉。判据必须是「这条渠道的线缆认不认 params.model」，不是「目录里有没有那行」。
//
// ── 即梦是这次改动的**回归警戒线**（最高风险行）──────────────────────────
//
// 即梦（dreamina）走本地 CLI，create op 根本**没有 HTTP body**——它的 model 藏在
// `--model_version={{request.params.model}}` 这条 argv 里。收窄逻辑若只扫 body，即梦会被误判成
// 「什么参数都发不出」→ 它 6 个活着的变体全被藏掉。所以 `wireReferencedParamKeys` 必须 body ∪
// process.args 一起算，而这一行就是那个判据的现场证人：**它必须仍然有变体选择器**。
//
// ── 为什么「Runway 没有变体」这句话必须先有阳性对照 ──────────────────────
//
// 「变体选择器不在」这种断言天然会空洞通过：模型下拉根本没渲染、composer 整个塌掉、选择器改了名——
// 三种情况下它一样成立。所以每一处 expectAbsent 都用 proveProbe 先在**它该出现的那一屏**（APIMart /
// 即梦）当场证明探针抓得到，再去 Runway 那屏证明它不在。没有阳性对照的绿灯不作数。
//
// ── 只覆盖画布面；提案面板那一半**验不了**，文件末尾如实声明原因 ──────────
//
// Agent 提案卡与画布节点共用 archetypeVariantAxisIsLive / archetypeModeIsVisible 这两个函数，
// 所以「同一套收窄」是由同一份实现保证的。但要在真机上把提案卡渲染出来，需要一个**可执行**的
// 文本模型，而渲染层的凭据写入被产品硬护栏强制成 enabled:false（见文件末尾 B 段的详细说明）。
// 与其伪造一个绿的，不如把这条边界写清楚。
//
// 用法：pnpm run build && node tests/ux/vendor-honest-variant-axis.walk.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, expectAbsent, proveProbe, clickOrFail } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/vendor-honest-variant-axis')
// 每次跑清空产出：上一轮的 PNG 留在盘里会被当成这一轮的证据去对账（比 mtime 才看得出的坑）。
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-variant-axis-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
const capabilityDir = path.join(tempRoot, 'capability')
fs.mkdirSync(projectsDir, { recursive: true })

const { app, win } = await launchNomiApp({
  name: 'vendor-honest-variant-axis',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
  capabilityDir,
  syntheticCredentialStorage: true,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let passed = 0
function record(label, detail = '') {
  passed += 1
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

let shotIndex = 0
async function shot(tag) {
  shotIndex += 1
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${tag}.png`)
  await win.screenshot({ path: file })
  return path.relative(repoRoot, file)
}

const composer = win.locator('.generation-canvas-v2-node__composer')
const modeGroup = composer.locator('[role="group"][aria-label="生成方式"]')
const modeButtons = modeGroup.locator('button')
// 变体选择器 = InlineParameterBar 里紧跟模型芯片的小下拉，aria-label 走 i18n 的
// generationCommon.parameters.variant（zh-CN = 「变体」）。它和「每次生成张数」(variantCountAria)
// 是两个东西，别混。
const variantSelect = composer.locator('[aria-label="变体"]')

/**
 * 读节点**真正绑定到**的模型身份（vendor + modelKey），而不是下拉里点了哪一条。
 *
 * 为什么变体栏的断言不够、必须先验身份：变体栏是**下游**。用户点了 Runway 的行、节点却被改绑到
 * APIMart 的行时，变体栏会诚实地显示 **APIMart 的**变体——每一层都在正确工作，合起来却是错的。
 * 「绑错家」与「收窄没生效」长得一模一样，而两者修法完全不同。所以身份闸必须排在控件读取之前。
 * （这不是假想：runway-vendor-honest-modes 走查首跑就抓到过 modelKey 被变体归一改写成别家的串。）
 */
async function readBoundIdentity() {
  return win.evaluate(() => {
    const el = document.querySelector('.generation-canvas-v2-node')
    const key = Object.keys(el || {}).find((k) => k.startsWith('__react'))
    let fiber = el && key ? el[key] : null
    let depth = 0
    while (fiber && depth < 400) {
      const meta = fiber.memoizedProps?.node?.meta
      if (meta && (meta.modelKey || meta.modelVendor)) {
        return {
          modelKey: meta.modelKey ?? null,
          modelVendor: meta.modelVendor ?? null,
          variantId: meta.archetype?.variantId ?? null,
          archetypeId: meta.archetype?.id ?? null,
        }
      }
      fiber = fiber.return
      depth += 1
    }
    return { modelKey: null, modelVendor: null, variantId: null, archetypeId: null }
  })
}

/**
 * 从 NomiSelect 里挑模型。`:visible` 是硬要求——Mantine 把未展开弹层的选项也留在 DOM 里，
 * 裸选会选到画布上别的下拉（变体、每次生成张数…）的选项。
 */
async function pickModel(match, humanLabel) {
  await clickOrFail(composer.locator('[aria-label="模型"]'), '模型下拉')
  const options = win.locator('[role="option"]:visible')
  await expect(options, '模型下拉点开了却一个选项都没有（目录空了？供应商没启用？）').not.toHaveCount(0)
  const texts = (await options.allTextContents()).map((t) => t.trim())
  const index = texts.findIndex(match)
  if (index < 0) throw new Error(`WALK FAIL: 模型下拉里没有「${humanLabel}」。实际选项：${JSON.stringify(texts)}`)
  await options.nth(index).click()
  await win.waitForTimeout(600)
  return texts[index]
}

/** 选中模型 + 身份闸。控件读取一律排在它后面。 */
async function selectAndBind({ pick, humanLabel, expectVendor, expectModelKey, tag }) {
  const picked = await pickModel(pick, humanLabel)
  const identity = await readBoundIdentity()
  const file = await shot(tag)
  if (identity.modelVendor !== expectVendor || identity.modelKey !== expectModelKey) {
    throw new Error(
      `WALK FAIL: 在下拉里点的是「${picked}」，节点却被绑到了别的模型身份。\n`
        + `  期望：vendor=${expectVendor} modelKey=${expectModelKey}\n`
        + `  实际：vendor=${identity.modelVendor} modelKey=${identity.modelKey} variantId=${identity.variantId}\n`
        + '  这不是变体收窄的问题——是选中的模型身份被改写了，下游的变体/模式/参数/发送全都会跟着走错家。\n'
        + `  截图：${file}`,
    )
  }
  return { picked, identity, file }
}

/** 读变体下拉当前展示的文案（视觉证据的 DOM 对照物）。控件不在时返回 null。 */
async function readVariantSummary() {
  if ((await variantSelect.count()) === 0) return null
  return (await variantSelect.first().innerText()).replace(/\s+/g, ' ').trim()
}

const observations = {}

try {
  // 语言/引导偏好钉死：模式栏与变体栏的断言都是中文文案，界面落到 en 会整片假红。
  // 这些偏好在首帧就被读走，所以写完让页面重载一次再往下走。
  //
  // 这里用 reload 是安全的、**且仅此一处**：此刻还在项目库那一屏、**一个项目都还没建**，
  // 不存在「activeProjectId 被刷成 null、面板静默空掉」的那个坑（那个坑的前提是已经打开了项目）。
  // 后面所有步骤都在这次 reload **之后**开始，全程不再 reload。
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    localStorage.setItem('nomi:locale:v1', 'zh-CN')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await win.reload({ waitUntil: 'domcontentloaded' })
  await win.waitForTimeout(2000)

  // 占位 key + 启用供应商：只为让这三家的视频模型进下拉。全程不点生成 → 零额度。
  // 即梦是 authType:"none"（本地 CLI 的设备码登录态，不是 HTTP bearer），故只 upsertVendor 不塞 key。
  await win.evaluate(async () => {
    for (const vendor of ['runway', 'apimart']) {
      await window.nomiDesktop.modelCatalog.upsertVendorApiKey(vendor, { apiKey: 'nomi-e2e-placeholder', enabled: true })
      await window.nomiDesktop.modelCatalog.upsertVendor({ key: vendor, enabled: true })
    }
    await window.nomiDesktop.modelCatalog.upsertVendor({ key: 'dreamina', enabled: true })

  })
  await win.waitForTimeout(2500)

  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((target) => {
    target.setBounds({ x: 0, y: 0, width: 1680, height: 1050 })
    target.center()
  })

  // ── 进场：新建空白项目 → 生成画布 → 加一个视频节点 ──────────────────────
  await clickOrFail(win.locator('button, [role="button"]', { hasText: '新建空白项目' }), '新建空白项目')
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }), '顶栏「生成」')
  await expectVisible(win.locator('.generation-canvas-v2-toolbar'), '生成画布工具栏出现')
  // data-node-kind 是结构锚点，不随语言变（aria-label「添加视频节点」走 i18n）。
  await clickOrFail(win.locator('.generation-canvas-v2-toolbar button[data-node-kind="video"]'), '工具条「视频」')
  await expectVisible(composer, '视频节点的浮动 composer 出现')
  record('新建空白项目 → 生成画布 → 加视频节点')

  // ══ A ①（阳性对照，必须排在 Runway 之前）APIMart Veo 3.1：变体轴**活着** ══
  // APIMart 的 veo mapping 写的是 model:"{{request.params.model}}" → 切变体真会换发出去的串
  // → 控件必须在。这一屏同时是下面「Runway 没有」的探针证明现场。
  const apimart = await selectAndBind({
    pick: (t) => t.startsWith('Veo 3.1') && t.includes('APIMart'),
    humanLabel: 'APIMart Veo 3.1',
    expectVendor: 'apimart',
    expectModelKey: 'veo3.1-fast',
    tag: 'apimart-veo31-variant-present',
  })
  const variantProof = await proveProbe(variantSelect, 'APIMart Veo 3.1 的「变体」选择器确实会出现')
  await expect(variantSelect, 'APIMart 的 veo mapping 参数化了 model，变体选择器必须在')
    .toHaveCount(1)
  apimart.variant = await readVariantSummary()
  apimart.modes = (await modeButtons.allTextContents()).map((t) => t.trim())
  observations['apimart/veo3.1-fast'] = apimart
  record(`APIMart Veo 3.1 绑定 ${apimart.identity.modelVendor}/${apimart.identity.modelKey} · 变体 = ${JSON.stringify(apimart.variant)} · 模式栏 = ${JSON.stringify(apimart.modes)}`, apimart.file)

  // ══ A ②（回归警戒线）即梦 Seedance：**没有 HTTP body**，变体全靠 CLI argv ══
  // 只扫 body 的实现会在这里把 6 个活着的变体一起藏掉。它必须仍然有变体选择器。
  const dreamina = await selectAndBind({
    pick: (t) => t.includes('即梦 Seedance'),
    humanLabel: '即梦 Seedance（会员）',
    expectVendor: 'dreamina',
    expectModelKey: 'dreamina-seedance-2.0',
    tag: 'dreamina-seedance-variant-present',
  })
  await expect(
    variantSelect,
    '即梦走本地 CLI、create op 根本没有 HTTP body，model 藏在 --model_version={{request.params.model}} 这条 argv 里。\n'
      + '  这里丢了变体选择器 = 收窄只扫了 body、没算 process.args（wireReferencedParamKeys 的回归），\n'
      + '  后果是即梦 6 个真能用的型号被一起藏掉——这是「收窄过头砍掉真功能」，比不收窄更糟。',
  ).toHaveCount(1)
  dreamina.variant = await readVariantSummary()
  dreamina.modes = (await modeButtons.allTextContents()).map((t) => t.trim())
  observations['dreamina/dreamina-seedance-2.0'] = dreamina
  record(`即梦 Seedance 绑定 ${dreamina.identity.modelVendor}/${dreamina.identity.modelKey} · 变体 = ${JSON.stringify(dreamina.variant)}`, dreamina.file)

  // ══ A ③（核心）Runway Veo 3.1：model 写死 → 变体轴整条不显示 ══════════════
  const runway = await selectAndBind({
    pick: (t) => t.startsWith('Runway Veo 3.1') && !t.includes('Fast'),
    humanLabel: 'Runway Veo 3.1',
    expectVendor: 'runway',
    expectModelKey: 'veo3.1',
    tag: 'runway-veo31-variant-absent',
  })
  await expectAbsent(variantSelect, {
    provenBy: variantProof,
    message: 'Runway 把 create op 的 model 写成字面量——切变体一个字节都不会变。\n'
      + '  控件还在 = 摆一个点了没反应的开关骗用户（比没有更糟）。\n'
      + '  Runway 本就不需要这条轴：它把 veo3.1 / veo3.1_fast 建成了两个目录行。',
  })
  // 同屏顺带钉住模式栏与比例没被这次改动误伤（变体轴与模式轴正交，收窄一条不许波及另一条）。
  await expect(modeButtons, 'Runway Veo 3.1 的模式栏不该被变体轴收窄波及').toHaveText(['文生视频', '首尾帧'])
  await clickOrFail(composer.locator('button[aria-label="生成参数"]'), '「生成参数」（Runway Veo 3.1）')
  const paramPanel = win.locator('[role="group"][aria-label="生成参数面板"]')
  await expectVisible(paramPanel, '生成参数面板打开')
  await expect(paramPanel, 'Runway 的 Veo 比例应当仍是像素式枚举 1280:720').toContainText('1280:720')
  runway.paramText = (await paramPanel.innerText()).replace(/\s+/g, ' ').trim().slice(0, 160)
  runway.paramShot = await shot('runway-veo31-params')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)
  runway.variant = await readVariantSummary()
  runway.modes = (await modeButtons.allTextContents()).map((t) => t.trim())
  observations['runway/veo3.1'] = runway
  record(`Runway Veo 3.1 绑定 ${runway.identity.modelVendor}/${runway.identity.modelKey} · 变体控件 = ${runway.variant === null ? '不存在（已收窄）' : JSON.stringify(runway.variant)} · 模式栏 = ${JSON.stringify(runway.modes)}`, runway.file)
  record('核心对照成立：同一条变体轴 APIMart / 即梦 露出、Runway 收窄消失')

  // ══ A ④ Runway 的其余变体行：同一条判据，逐行钉死 ══════════════════════════
  // 静态探针（对真实种子目录跑 wireReferencedParamKeys）说 Runway 的 6 个带变体行**全部**惰性。
  // 只验 veo3.1 一行的话，「收窄只对某一行生效」这种半吊子回归会溜过去，所以逐行都走一遍。
  for (const row of [
    { pick: (t) => /Runway Seedance 2Runway/.test(t), label: 'Runway Seedance 2', modelKey: 'seedance2', tag: 'runway-seedance2-variant-absent' },
    { pick: (t) => /Runway Seedance 2 FastRunway/.test(t), label: 'Runway Seedance 2 Fast', modelKey: 'seedance2_fast', tag: 'runway-seedance2-fast-variant-absent' },
    { pick: (t) => /Runway Seedance 2 MiniRunway/.test(t), label: 'Runway Seedance 2 Mini', modelKey: 'seedance2_mini', tag: 'runway-seedance2-mini-variant-absent' },
    { pick: (t) => t.startsWith('Runway Wan 3'), label: 'Runway Wan 3', modelKey: 'wan3', tag: 'runway-wan3-variant-absent' },
  ]) {
    const bound = await selectAndBind({
      pick: row.pick, humanLabel: row.label, expectVendor: 'runway', expectModelKey: row.modelKey, tag: row.tag,
    })
    await expectAbsent(variantSelect, {
      provenBy: variantProof,
      message: `${row.label} 的 create op 同样把 model 写死，变体选择器不该出现。`,
    })
    bound.variant = await readVariantSummary()
    bound.modes = (await modeButtons.allTextContents()).map((t) => t.trim())
    observations[`runway/${row.modelKey}`] = bound
    record(`${row.label} 绑定 ${bound.identity.modelVendor}/${bound.identity.modelKey} · 变体控件 = 不存在（已收窄） · 模式栏 = ${JSON.stringify(bound.modes)}`, bound.file)
  }

  // ── 回切阳性对照：证明「消失」不是整个控件层塌了 ──────────────────────────
  // 上面连着 5 行都「没有变体选择器」。如果此刻 composer 其实已经渲染坏了、或者选择器改了名，
  // 这 5 条会一起假绿。所以最后回到 APIMart 再证一次它**还回得来**——一次性排除这两种系统性假绿。
  const backToApimart = await selectAndBind({
    pick: (t) => t.startsWith('Veo 3.1') && t.includes('APIMart'),
    humanLabel: 'APIMart Veo 3.1（回切）',
    expectVendor: 'apimart',
    expectModelKey: 'veo3.1-fast',
    tag: 'contrast-back-to-apimart-variant-returns',
  })
  await expect(
    variantSelect,
    '回切 APIMart 后变体选择器必须重新出现。它没回来 = 上面那 5 条「不存在」全是假绿（控件层塌了/改名了），\n'
      + '  而不是收窄生效——两者长得一模一样，这一条就是用来把它们分开的。',
  ).toHaveCount(1)
  backToApimart.variant = await readVariantSummary()
  observations['contrast/back-to-apimart'] = backToApimart
  record(`回切阳性对照成立：变体选择器重新出现 = ${JSON.stringify(backToApimart.variant)}`, backToApimart.file)

  // ══ B：Agent 提案面板的模式/变体收窄 —— **本走查无法覆盖，如实声明** ══════
  //
  // 这不是「懒得验」，是**验不了**，原因在产品的一条硬护栏上：
  //
  // 提案卡（GenerationProposalEditor）只在「Agent 真的发起了一轮、并回了一条生成类工具调用」时才渲染。
  // 要让 Agent 跑起来，得有一个**可执行**的文本模型；而 `listOnboardingAgentCandidates` 要求该供应商
  // 的凭据能被 `decryptApiKeyRecord` 解出非空明文、且 `apiKeysByVendor[vendor].enabled === true`。
  //
  // 关键在后半句：渲染层写凭据的唯一入口 `upsertRendererCatalogVendorApiKey` 会**强制**
  // `sanitizeRendererVendorApiKeyMutation → { enabled: false }`（rendererCatalogMutation.ts:156），
  // 注释写明「渲染层的凭据写入只是配置，永远不能把供应商提升为可用，那是 certification 的职责」。
  // 也就是说：**任何只靠渲染层 API 播种的走查都造不出一个能跑的 Agent**——这是有意的 fail-closed 护栏，
  // 不是可以绕的障碍。绕过去（直接改盘上 catalog 文件 / 伪造 certification）就不再是真机走查了。
  //
  // 因此本走查**只证 A（画布面）**，B 面留给下列已有手段，别在这里造一个骗自己的绿：
  //   · 单测已覆盖同一判据：`channelModeReach.test.ts` 直接喂 (body, wireParamKeys) 断言
  //     `archetypeVariantAxisIsLive` / `archetypeModeIsVisible`，而提案卡与画布**共用**这两个函数
  //     （GenerationProposalEditor 与 NodeParameterControls 都 import 它们）——即「同一套收窄」这件事
  //     本身是由「同一个函数」保证的，不是靠两处各写一遍期望值。
  //   · 真要在 UI 上验 B，得走 agent-runtime 系列走查那条路（它们在有可执行凭据的环境里跑）。
  record('B（提案面板）如实声明未覆盖：渲染层无法播种可执行凭据 → 提案卡渲染不出来，见文件内注释')


  const summaryPath = path.join(shotsDir, 'observed-variant-axis.json')
  fs.writeFileSync(summaryPath, JSON.stringify(observations, null, 2))
  console.log('\n观察到的变体轴（DOM 读数）：')
  for (const [key, value] of Object.entries(observations)) {
    console.log(`  ${key.padEnd(34)} 变体=${value.variant === null || value.variant === undefined ? (value.variantPresent === false ? '不存在' : 'n/a') : JSON.stringify(value.variant)}  模式=${JSON.stringify(value.modes ?? [])}`)
  }
  console.log(`\n✅ 走查通过：${passed} 条判据 · 截图 ${path.relative(repoRoot, shotsDir)}/`)
} catch (error) {
  await shot('FAIL').catch(() => {})
  console.error(`\n${error?.message || error}`)
  await app.close().catch(() => {})
  process.exit(1)
} finally {
  await app.close().catch(() => {})
}
