// 穿透走查（规则 13）—— Runway 十行视频模型「按真实身份收窄模式栏」，**零额度**（全程不发生成请求）。
//
// ── 这份走查在证什么 ──────────────────────────────────────────────────────
//
// 改动前：Runway 的 10 行视频模型全部挂在同一个**平台形状**的档案 `runway-video` 上。那个档案的模式栏
// 恒为「文生视频 / 图生视频 / 多图参考」——与所选模型真正支不支持无关。于是模式栏在**撒谎**：Veo 在
// Runway 的 union 里压根没有 reference 字段，用户却看得到「多图参考」，点了要等到第三闸才被拒。
//
// 改动后：每一行指向它**真实模型自己的档案**（veo-3.1 / happyhorse / gemini-omni-1.1 / seedance-2 /
// grok-imagine-1.5-video…），模式栏再按 `archetypeModeIsVisible` 收窄到「这条渠道真发得出的模式」。
//
// **本走查的核心判据是最后一条对照**：`veo-3.1` 是**同一个档案**，走 Runway 只该露 2 个模式
// （文生视频 / 首尾帧），走 APIMart 该露全 3 个（文生视频 / 参考图 / 首尾帧）。两边长得一样 = 收窄没生效，
// 这份走查必须报红。一个档案、两张诚实的脸，正是这次改动的全部意义。
//
// ── 为什么每条断言都同时验「该有的」和「不该有的」 ────────────────────────
//
// 只验「多图参考没了」是空洞的：模式栏根本没渲染出来时它同样成立。所以每一行都用
// `toHaveText([...])` 钉死**完整有序的模式列表**——多一个少一个都报红，正负两面同时成立。
// `expectAbsent` 只用在「先在它会出现的现场证明过探针」的那两处（APIMart 的参考图 → Runway 的没有）。
//
// ── 进场为什么要自己开供应商 ──────────────────────────────────────────────
//
// 走查默认跑**隔离 profile**（不碰用户真实资料库）。种子目录在启动时自动 reconcile，但模型下拉只列
// **已启用且有 key 的**供应商——所以要 upsertVendorApiKey（占位串，全程不点生成 → 零额度）**加**
// upsertVendor({enabled:true})：那两个 enabled 是两个东西（key 的启用 ≠ 供应商的启用），只做前者
// 下拉里恒为 1 个选项，看起来就像目录空了。NOMI_CAPABILITY_DIR 一并隔离，防串库。
//
// ── 曾经抓到的缺陷（2026-09-02 首跑报红 → 同日已修，本走查现在全绿）────────
//
// 保留这段是因为它是这份走查**存在的理由**：下面两行当初的红，是同一个根因。
// 修法见 useNodeModelAutoSelect.ts 变体迁移 effect 的 `if (selectedModelOption) return`——
// 迁移只准处理「在当前目录里已经解析不到的旧串」，绝不许改写一个活着的 (vendor, modelKey)。
//
//   `normalizeArchetypeVariantMeta`（archetypeMeta.ts）把 Runway 的 modelKey 误判成
//   「旧项目钉死的某个变体全串」，于是折叠成档案的**基础 modelKey**——而那个基础 key 属于 APIMart：
//     · veo-3.1 的 fast 变体声明 identifierPatterns: ["veo3.1", "veo-3.1"]
//       → Runway 的 `veo3.1` 命中它 → meta.modelKey 被改写成 `veo3.1-fast`（APIMart 的 key）
//       → findModelOptionByIdentifier 只匹配得到 APIMart 那一行 → 节点**静默改绑 apimart**
//       → 模式栏于是诚实地显示 APIMart 的三个模式（含「参考图」）。收窄逻辑本身没坏。
//     · seedance-2 的 standard 变体声明 identifierPatterns: ["seedance-2", "seedance2"]
//       → Runway 的 `seedance2` 命中 → modelKey 被改写成 `bytedance/seedance-2`，
//         而 vendor 仍是 runway → 这个 (runway, bytedance/seedance-2) 组合**在目录里不存在**
//       → 节点面板直接崩成「节点生成面板加载失败」，并弹「原供应商已断开，已自动切换到…」。
//
// 换句话说：`identifierPatterns` 是**供应商无关**的裸串匹配，而变体轴本身是 APIMart 的形状。
// Runway 行原本挂平台档案 `runway-video`（无 variants）时碰不到这段；改指真实档案后才暴露。
// 所以这两行不是「收窄没做」，是**模型身份在下游被改写**——修的地方在变体归一，不在模式栏。
//
// 用法：pnpm run build && node tests/ux/runway-vendor-honest-modes.walk.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, expectAbsent, proveProbe, clickOrFail } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/runway-vendor-honest-modes')
// 每次跑清空产出：上一轮的 PNG 留在盘里会被当成这一轮的证据去对账（比 mtime 才看得出的坑）。
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-runway-honest-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
const capabilityDir = path.join(tempRoot, 'capability')
fs.mkdirSync(projectsDir, { recursive: true })

const { app, win } = await launchNomiApp({
  name: 'runway-vendor-honest-modes',
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
  return file
}

const composer = win.locator('.generation-canvas-v2-node__composer')
const modeGroup = composer.locator('[role="group"][aria-label="生成方式"]')
const modeButtons = modeGroup.locator('button')
const paramPanel = win.locator('[role="group"][aria-label="生成参数面板"]')

/**
 * 读节点**真正绑定到**的模型身份（vendor + modelKey），而不是下拉里点了哪一条。
 *
 * 为什么模式栏的断言不够、必须再验身份：模式栏是**下游**。用户点了 Runway 的行、节点却被改绑到
 * APIMart 的行时，模式栏会诚实地显示 **APIMart 的**能力——每一层都在正确工作，合起来却是错的。
 * 只看模式栏的话，这种「绑错家」会长得跟「收窄没生效」一模一样，而两者的修法完全不同。
 * 所以每一行都同时钉：① 绑定身份 = 我点的那家 ② 模式栏 = 那家真发得出的模式。
 */
async function readBoundIdentity() {
  return win.evaluate(() => {
    const el = document.querySelector('.generation-canvas-v2-node')
    const key = Object.keys(el || {}).find((k) => k.startsWith('__react'))
    let fiber = el && key ? el[key] : null
    let depth = 0
    while (fiber && depth < 400) {
      const props = fiber.memoizedProps
      const meta = props?.node?.meta
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
  await expect(options, `模型下拉点开了却一个选项都没有（目录空了？供应商没启用？）`).not.toHaveCount(0)
  const texts = (await options.allTextContents()).map((t) => t.trim())
  const index = texts.findIndex(match)
  if (index < 0) throw new Error(`WALK FAIL: 模型下拉里没有「${humanLabel}」。实际选项：${JSON.stringify(texts)}`)
  await options.nth(index).click()
  await win.waitForTimeout(500)
  return texts[index]
}

/** 读当前模式栏的按钮文案（视觉证据的 DOM 对照物）。 */
async function readModes() {
  return (await modeButtons.allTextContents()).map((t) => t.trim())
}

/**
 * 一行的判据：选中模型 → 模式栏**完整有序**等于 expected → 截图。
 * 用 toHaveText(数组) 而不是逐条 toBeVisible：它同时钉死「该有的都在」和「不该有的一个都没多」，
 * 正负两面在同一条断言里成立——少写一半就是那种「看起来在验、其实恒真」的空洞检查。
 */
async function assertModeBar({ pick, humanLabel, expectVendor, expectModelKey, expected, tag }) {
  const picked = await pickModel(pick, humanLabel)

  // ① 身份闸：先证「点了哪家就绑哪家」。它必须排在模式栏之前——绑错家时模式栏显示的是**另一家**的
  //    能力，此时再去断言模式栏，读到的红/绿都指向错误的方向。
  const identity = await readBoundIdentity()
  const file = await shot(tag)
  const identityOk = identity.modelVendor === expectVendor && identity.modelKey === expectModelKey
  if (!identityOk) {
    throw new Error(
      `WALK FAIL: 在下拉里点的是「${picked}」，节点却被绑到了别的模型身份。\n`
        + `  期望：vendor=${expectVendor} modelKey=${expectModelKey}\n`
        + `  实际：vendor=${identity.modelVendor} modelKey=${identity.modelKey} variantId=${identity.variantId}\n`
        + '  这不是模式栏收窄的问题——是选中的模型身份被改写了，下游的模式栏/参数/发送全都会跟着走错家。\n'
        + `  截图：${path.relative(repoRoot, file)}`,
    )
  }

  // ② 模式栏闸：身份对了，才轮到「这家该露哪几个模式」。
  await expectVisible(modeGroup, `「${humanLabel}」的「生成方式」分段条应当出现`)
  await expect(
    modeButtons,
    `「${humanLabel}」的模式栏与真实能力不符。\n`
      + `  期望（= 这家的 mapping 真发得出的模式）：${JSON.stringify(expected)}\n`
      + '  多出来的模式 = 模式栏在撒谎（用户点了要等第三闸才被拒），少了的 = 收窄过头，砍掉了真能用的功能。\n'
      + `  截图：${path.relative(repoRoot, file)}`,
  ).toHaveText(expected)
  const observed = await readModes()
  record(`${humanLabel} 绑定 ${identity.modelVendor}/${identity.modelKey} · 模式栏 = ${JSON.stringify(observed)}`, path.basename(file))
  return { picked, identity, observed, file }
}

const observations = {}

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  // 占位 key + 启用供应商：只为让 Runway / APIMart 的视频模型进下拉。全程不点生成 → 零额度。
  await win.evaluate(async () => {
    for (const vendor of ['runway', 'apimart']) {
      await window.nomiDesktop.modelCatalog.upsertVendorApiKey(vendor, { apiKey: 'nomi-e2e-placeholder', enabled: true })
      await window.nomiDesktop.modelCatalog.upsertVendor({ key: vendor, enabled: true })
    }
  })
  await win.waitForTimeout(2000)

  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((target) => {
    target.setBounds({ x: 0, y: 0, width: 1680, height: 1050 })
    target.center()
  })

  // ── 进场：新建空白项目 → 生成画布 → 加一个视频节点 ──────────────────────
  await clickOrFail(win.locator('button, [role="button"]', { hasText: '新建空白项目' }), '新建空白项目')
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }), '顶栏「生成」')
  await expectVisible(win.locator('.generation-canvas-v2-toolbar'), '生成画布工具栏出现')
  // data-node-kind 是结构锚点，不随语言变（aria-label「添加视频节点」走 i18n，英文界面下会变）。
  await clickOrFail(win.locator('.generation-canvas-v2-toolbar button[data-node-kind="video"]'), '工具条「视频」')
  await expectVisible(composer, '视频节点的浮动 composer 出现')
  record('新建空白项目 → 生成画布 → 加视频节点')

  // ── ① Runway Veo 3.1：veo union 只有 promptImage，**没有 reference 字段** ──
  // 旧的平台档案在这里会露「多图参考」；真实的 veo-3.1 档案声明了 reference 模式，但 Runway 这条
  // 渠道取不到它的 mapping（判据 a）→ 必须被收窄掉，只剩文生视频 + 首尾帧。
  observations['runway/veo3.1'] = await assertModeBar({
    pick: (t) => t.startsWith('Runway Veo 3.1') && !t.includes('Fast'),
    humanLabel: 'Runway Veo 3.1',
    expectVendor: 'runway',
    expectModelKey: 'veo3.1',
    expected: ['文生视频', '首尾帧'],
    tag: 'runway-veo31',
  })

  // 参数控件也必须是 Runway 的真值：比例是像素式枚举（1280:720…，不是通用的 16:9），
  // 时长只给 4/6/8（Veo 只接受这三个；此前通用控件给 1-30 秒，传输层再默默夹到 4——
  // 用户选的数和真正生成的长度不是一回事）。
  await clickOrFail(composer.locator('button[aria-label="生成参数"]'), '「生成参数」（Runway Veo 3.1）')
  await expectVisible(paramPanel, '生成参数面板打开')
  const veoParamText = (await paramPanel.innerText()).replace(/\s+/g, ' ').trim()
  await expect(paramPanel, 'Runway 的 Veo 比例应当是像素式枚举 1280:720，不是通用的 16:9')
    .toContainText('1280:720')
  observations['runway/veo3.1'].paramText = veoParamText
  observations['runway/veo3.1'].paramShot = await shot('runway-veo31-params')
  record('Runway Veo 3.1 参数：比例给像素枚举（含 1280:720）', veoParamText.slice(0, 120))
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)

  // ── ② Runway HappyHorse 1.0：档案有 4 模式，Runway 只发得出前两个 ─────────
  // happyhorse 档案声明 t2v / i2v / ref / edit；Runway 的 spec 只映射了 t2v + image→i2v，
  // 「角色参考」「视频编辑」在这条渠道没有自己的线缆（判据 a）→ 收窄掉。
  observations['runway/happyhorse_1_0'] = await assertModeBar({
    pick: (t) => t.startsWith('Runway HappyHorse 1.0'),
    humanLabel: 'Runway HappyHorse 1.0',
    expectVendor: 'runway',
    expectModelKey: 'happyhorse_1_0',
    expected: ['文生视频', '图生视频'],
    tag: 'runway-happyhorse',
  })

  // ── ③ Runway Gemini Omni Flash：同 veo，union 里没有 reference 字段 ────────
  observations['runway/gemini_omni_flash'] = await assertModeBar({
    pick: (t) => t.startsWith('Runway Gemini Omni Flash'),
    humanLabel: 'Runway Gemini Omni Flash',
    expectVendor: 'runway',
    expectModelKey: 'gemini_omni_flash',
    expected: ['文生视频', '首尾帧'],
    tag: 'runway-gemini-omni-flash',
  })

  // ── ④ Runway Grok Imagine 1.5：图生视频**必须留着** ───────────────────────
  // 反向判据（防收窄过头）：Runway 的 Grok 确实支持图生视频，只是一次一张。曾经有过一条
  // 「多图塌成单图就隐藏」的判据，它唯一命中的就是这里——等于删掉一个真能用的功能，已删除。
  // 承载力缩水是**槽级**的事（槽如实收成 1 张），不是模式级的隐藏理由。
  observations['runway/grok_imagine_1_5'] = await assertModeBar({
    pick: (t) => /Runway Grok Imagine 1\.5Runway/.test(t),
    humanLabel: 'Runway Grok Imagine 1.5',
    expectVendor: 'runway',
    expectModelKey: 'grok_imagine_1_5',
    expected: ['文生视频', '图生视频'],
    tag: 'runway-grok-imagine-15',
  })

  // ── ⑤ 核心对照：APIMart 的 Veo 3.1 —— **同一个档案，更宽的脸** ─────────────
  // 走 APIMart 时 reference 模式取得到自己的 mapping → 三个模式全露。
  // 与 ① 是同一个 `veo-3.1` 档案：两边一样宽 = 收窄没生效，这份走查的意义就没了。
  observations['apimart/veo3.1-fast'] = await assertModeBar({
    // 「Veo 3.1APIMart」——不能用 startsWith('Runway')，也不能只 includes('Veo 3.1')（会串到 Runway 那两行）。
    pick: (t) => t.startsWith('Veo 3.1') && t.includes('APIMart'),
    humanLabel: 'APIMart Veo 3.1',
    expectVendor: 'apimart',
    expectModelKey: 'veo3.1-fast',
    expected: ['文生视频', '参考图', '首尾帧'],
    tag: 'apimart-veo31',
  })

  // 「参考图」确实会出现——**必须在它该出现的那一屏当场证**（此刻选中的正是 APIMart 的 Veo 3.1）。
  // 别挪到后面去：下面还要选 Seedance 2，那一屏本来就没有「参考图」，探针在那里必然找不到——
  // 于是基线报红，而红的是「探针站错了现场」，不是产品。证明必须紧贴它所证的那一屏。
  const referenceProof = await proveProbe(
    modeGroup.locator('button', { hasText: '参考图' }),
    'APIMart 的 Veo 3.1 模式栏里「参考图」确实会出现',
  )
  record('对照成立：同一个 veo-3.1 档案在 APIMart 露 3 个模式（含「参考图」）')

  // ── ⑥ Runway Seedance 2：t2v + 首帧 + 全能参考，**没有首尾帧** ─────────────
  // seedance-2 档案有 4 模式（t2v/first/firstlast/omni）；Runway 的 spec 把 image 角色映射到
  // `first`、refs 角色映射到 `omni`，**没有 firstlast 角色**→「首尾帧」必须不出现。
  // 这一条同时证明收窄不是「一刀切砍成两个」：Runway 这行确实露得出三个。
  //
  // **它排在最后是有原因的**：修复前这一行会把整个 composer 打没（见文件头的「曾经抓到的缺陷」）。
  // 放中间的话，它之后的每一行都会因为「模型下拉不存在」而连坐报红，真正的首个失灵点被埋掉。
  // 修好后位置照旧不动：万一将来再复发，仍然只炸这一行、不连坐——顺序本身就是一道诊断装置。
  observations['runway/seedance2'] = await assertModeBar({
    // 选项文本前会挂一个身份徽标字符（如 "DRunway Seedance 2Runway Dev"），故不能用 startsWith。
    pick: (t) => /Runway Seedance 2Runway/.test(t),
    humanLabel: 'Runway Seedance 2',
    expectVendor: 'runway',
    expectModelKey: 'seedance2',
    expected: ['文生视频', '首帧', '全能参考'],
    tag: 'runway-seedance2',
  })

  // ── 回到 Runway 的 Veo 3.1：同档案，「参考图」必须消失 ─────────────────────
  // 这才是这次改动的**唯一充分证据**：不是「Runway 这行本来就窄」，而是同一个档案换条渠道就收窄。
  await pickModel((t) => t.startsWith('Runway Veo 3.1') && !t.includes('Fast'), 'Runway Veo 3.1（回切）')
  await expect(modeButtons, '回切 Runway 后模式栏应当重新收窄成 2 个').toHaveText(['文生视频', '首尾帧'])
  await expectAbsent(modeGroup.locator('button', { hasText: '参考图' }), {
    provenBy: referenceProof,
    message: '同一个 veo-3.1 档案走 Runway 时不该露「参考图」（Runway 的 veo union 没有 reference 字段）',
  })
  observations['contrast'] = { file: await shot('contrast-runway-veo31-narrowed') }
  record('核心对照：同一 veo-3.1 档案 APIMart 3 模式 → Runway 收窄成 2，「参考图」消失')

  const summaryPath = path.join(shotsDir, 'observed-modes.json')
  fs.writeFileSync(summaryPath, JSON.stringify(observations, null, 2))
  console.log(`\n观察到的模式栏（DOM 文案）：`)
  for (const [key, value] of Object.entries(observations)) {
    if (value.observed) console.log(`  ${key.padEnd(28)} ${JSON.stringify(value.observed)}`)
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
