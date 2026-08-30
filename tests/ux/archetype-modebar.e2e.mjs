// 穿透走查（规则 13）—— 模型档案的「生成方式」模式分段条，**零额度**（全程不发生成请求）。
//
// 覆盖的真实功能（此前无任何自动化在验）：
//   · Seedance 2.0 的模式分段条：文生视频 / 首帧 / 首尾帧 / 全能参考（标签用**模型自己的真名**，决策 #2）
//   · 切模式 → 参考槽跟着换：首尾帧出「首帧 + 尾帧」两槽、全能参考合并成一排 tile + 一个「加参考」
//   · **模式互斥（M2）**：切走后上一模式的槽必须消失——这是 archetypeMeta 的核心不变量
//   · 变体轴：标准/快速/Mini 收窄清晰度（快速只剩 480/720，无 1080p/4k）
//   · HappyHorse 1.0 换一套 4 模式真名，且它无变体轴
//
// ── 这份走查为什么被重写（2026-08-18）──
//
// 它长期跑不动，一条断言都没执行过。三处过期，每一处都足以让它开局就超时：
//
//  ① **跑在用户真实资料库上**：`launchNomiApp({ name })` 不给隔离目录，靠点「示例：30 秒产品介绍」进项目
//     ——那张卡只在**空库**才出现，任何有真实项目的机器上必然等到超时。
//     → 改成隔离 tempdir + 「新建空白项目」（与 default-generation-model.walk.mjs 同一条进场路径）。
//
//  ② **模型选择器早已不是原生 `<select>`**：现在是 NomiSelect（Mantine Combobox，button 触发 + portal 弹层），
//     `selectOption()` 无从下手。→ 改成点触发再从 `[role="option"]:visible` 里挑。
//     **`:visible` 不能省**：Mantine 把未展开弹层的选项也留在 DOM 里，裸 querySelectorAll 会选到别的下拉的选项。
//
//  ③ **断言的前提本身过期了**（比选择器更要命，改对选择器也救不回来）：
//     · Seedance 现在是 **4** 模式不是 3 ——「文生视频」是后来补的（此前 kie 用户做不了文生视频），
//       且 `defaultModeId` 已改成 t2v；旧断言等的是首帧模式的提示行「单张首帧图驱动生成」，永远等不到。
//     · **「Seedance 2.0 Fast」不再是下拉里的一个模型**，它变成了**变体**（标准/快速/Mini，第二个下拉）。
//       旧脚本 `selectOption({label:'Seedance 2.0 Fast'})` 选的是一个不存在的东西。
//     · 「放入哪张」「用 character1」这两句 UI 文案已从产品里删掉（src/ 零命中），@ 建议面板改成了
//       `[data-mention-list]` + `[data-mention-item]` 的结构化锚点。
//
// 所有断言走 `_assert.mjs`：点击一律 clickOrFail（点不到就报红，不再 `count()>0` + `.catch(()=>{})` 静默跳过），
// 「不存在」一律 expectAbsent + proveProbe（先在它**会出现**的现场证明探针测得到，再切走断言它没了）。
// 这里的两条 absence 恰好是产品的真不变量（模式互斥 / 变体收窄），不是空洞通过。
//
// 用法：pnpm run build && node tests/ux/archetype-modebar.e2e.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, expectAbsent, proveProbe, clickOrFail } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/archetype-modebar')
// 每次跑清空产出：上一轮的 PNG 留在盘里会被当成这一轮的产出去对账。
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-archetype-modebar-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
fs.mkdirSync(projectsDir, { recursive: true })

const { app, win } = await launchNomiApp({
  name: 'archetype-modebar',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
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
  await win.screenshot({ path: path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${tag}.png`) })
}

const composer = win.locator('.generation-canvas-v2-node__composer')
const modeGroup = composer.locator('[role="group"][aria-label="生成方式"]')
const activeMode = modeGroup.locator('button[aria-pressed="true"]')
const paramPanel = win.locator('[role="group"][aria-label="生成参数面板"]')
/** 参考槽/参考 tile 的锚点：aria-label 上带槽名，切模式时整组换掉。 */
const slot = (label) => composer.locator(`[aria-label="${label}"]`)

/** 切模式并断言真的切过去了（点了 ≠ 换了）。 */
async function switchMode(vendorTerm) {
  await clickOrFail(modeGroup.locator('button', { hasText: vendorTerm }), `模式「${vendorTerm}」`)
  await expect(activeMode, `点了「${vendorTerm}」但分段条的选中项没换过去`).toHaveText(vendorTerm)
}

/**
 * 从 NomiSelect 里挑一个选项。
 * `:visible` 是硬要求——Mantine 的下拉挂在 body 的 portal 里，画布上那些**没展开**的下拉
 * （变体、每次生成张数…）其选项同样在 DOM 中，裸选会选到别人家的。
 */
async function pickFromSelect(triggerLabel, match, humanLabel) {
  await clickOrFail(composer.locator(`[aria-label="${triggerLabel}"]`), `${humanLabel}下拉`)
  const options = win.locator('[role="option"]:visible')
  await expect(options, `${humanLabel}下拉点开了却一个选项都没有`).not.toHaveCount(0)
  const texts = (await options.allTextContents()).map((t) => t.trim())
  const index = texts.findIndex(match)
  if (index < 0) throw new Error(`WALK FAIL: ${humanLabel}下拉里没有目标选项。实际选项：${JSON.stringify(texts)}`)
  await options.nth(index).click()
  return texts[index]
}

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)

  // 占位 key：只为让 kie 的视频模型进目录。全程不点生成 → 零额度。
  await win.evaluate(() =>
    window.nomiDesktop?.modelCatalog?.upsertVendorApiKey('kie', { apiKey: 'nomi-e2e-placeholder', enabled: true }),
  )
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)

  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((target) => {
    target.setBounds({ x: 0, y: 0, width: 1600, height: 1050 })
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
  await shot('video-node')

  // ── 选 Seedance 2.0 ─────────────────────────────────────────────────────
  // 只认**以「Seedance 2.0」开头**的那条：目录里还有「Seedance 2.5」和「即梦 Seedance 2.0（会员）」，
  // 用 includes 会串台到别家。选项文本是「标签 + 供应商」拼起来的（如 "Seedance 2.0Kie"）。
  const pickedModel = await pickFromSelect('模型', (t) => t.startsWith('Seedance 2.0'), '模型')
  await expect(composer.locator('[aria-label="模型"]'), '模型芯片没变成 Seedance 2.0').toHaveText(/Seedance 2\.0/)
  record('模型下拉选中 Seedance 2.0', pickedModel)

  // ── 模式分段条：4 个模式，标签用模型自己的真名 ───────────────────────────
  await expectVisible(modeGroup, '「生成方式」分段条出现')
  await expect(modeGroup.locator('button'), 'Seedance 2.0 应当有 4 个模式').toHaveCount(4)
  await expect(modeGroup.locator('button'), '模式标签必须是 vendor 真名（决策 #2：不换成意图词）')
    .toHaveText(['文生视频', '首帧', '首尾帧', '全能参考'])
  record('「生成方式」分段条 = 4 个 vendor 真名（文生视频/首帧/首尾帧/全能参考）')

  // 默认落在 t2v，提示行是它自己的说明（档案 defaultModeId: 't2v'）。
  await expect(activeMode, '新节点默认没落在「文生视频」').toHaveText('文生视频')
  await expectVisible(composer.getByText('纯文字描述生成视频，无需参考图'), '提示行显示当前模式说明')
  record('默认模式 = 文生视频，提示行随模式走')
  await shot('seedance-t2v')

  // ── 首尾帧：出「首帧 + 尾帧」两个槽 ──────────────────────────────────────
  await switchMode('首尾帧')
  await expectVisible(slot('添加首帧'), '首尾帧模式出现「首帧」参考槽')
  await expectVisible(slot('添加尾帧'), '首尾帧模式出现「尾帧」参考槽')
  await expectVisible(composer.getByText('首帧 + 尾帧，过渡更可控'), '提示行更新为首尾帧的说明')
  record('切「首尾帧」→ 首帧 + 尾帧两个参考槽出现，提示行同步')
  await shot('firstlast')

  // 在**它确实存在**的现场先把探针证明了，下面切走后的「消失」才不是空话。
  const lastFrameProof = await proveProbe(slot('添加尾帧'), '首尾帧模式下「尾帧」槽确实会出现')

  // ── 全能参考（omni）：数组参考合并成一排 tile + 一个「加参考」 ─────────────
  await switchMode('全能参考')
  await expectVisible(slot('加参考'), 'omni：合并成一排 + 一个「加参考」（样张 v4）')
  await expectVisible(composer.getByText('多模态参考；最多 9 角色 / 3 视频 / 3 音频'), 'omni 提示行')
  // 模式互斥（M2）：切到 omni 后首/尾帧槽必须收走——档案的核心不变量，残留会让 Seedance 收到互斥字段 422。
  await expectAbsent(slot('添加尾帧'), {
    provenBy: lastFrameProof,
    message: 'omni 模式下不该还留着「尾帧」槽（模式互斥 M2）',
  })
  record('切「全能参考」→ 合并成一排 tile + 一个「加参考」，首尾帧槽被收走（M2 互斥）')
  await shot('omni')

  const addRefProof = await proveProbe(slot('加参考'), 'omni 模式下「加参考」确实会出现')

  // 描述框 placeholder 的「打 @ 可引用参考图」尾巴：**还没有参考图时不该挂**（会指向一个空面板）。
  // 基线文案从真实 DOM 读出来、不写死，这样改 placeholder 主文案不会误伤这条。
  const placeholderNode = win.locator('.generation-canvas-v2-node__prompt-input [data-placeholder]')
  const basePlaceholder = await placeholderNode.getAttribute('data-placeholder')

  // ── 往 omni 槽里放一张图：tile 带编号 + 可拖拽重排 ────────────────────────
  const tmpPng = path.join(tempRoot, 'char1.png')
  fs.writeFileSync(
    tmpPng,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
  )
  await clickOrFail(composer.locator('button[aria-label="加参考"]'), 'omni 的「加参考」')
  // 素材选择器里有两个 file input，只有带 aria-label 的那个是「上传本地文件」入口；
  // 挑错了会静默什么都不发生（本轮探针栽过一次）。
  await win.locator('input[type="file"][aria-label="上传本地文件"]').first().setInputFiles(tmpPng)
  // 等「tile 出现」这个事实，而不是睡一个够长的觉——本地素材导入耗时会变。
  await expectVisible(slot('角色参考1'), '上传后角色图 tile 带顺序编号（aria-label = 角色参考1，即 character1）')
  await expectVisible(composer.locator('[aria-label="角色参考1"][draggable="true"]'), '参考 tile 可拖拽重排')
  record('omni 上传一张 → tile 按顺序编号 ①（角色参考1）且可拖拽重排')
  await shot('omni-uploaded')

  // 有参考图了 → placeholder 尾巴才挂上「打 @ 可引用参考图」（@ 是加速器，得先有东西可引用）。
  // placeholder 是 tiptap 扩展在创建时配死的，靠 PromptEditor 传函数 + 空事务重画才跟得上；
  // 这条判据同时钉住那套接线：谁把它改回直接传字符串，这里立刻报红。
  await expect(placeholderNode, '加了参考图后 placeholder 应当挂上「打 @」提示')
    .toHaveAttribute('data-placeholder', `${basePlaceholder} · 打 @ 可引用参考图`)
  record('有参考图后，描述框 placeholder 才挂出「打 @ 可引用参考图」')

  // ── 引用参考图的**主路径**：点 tile 直接往描述框光标处插 chip ───────────────
  // 这条是可发现的那条（tile 就摆在眼前、点一下是人人会试的动作）；下面的 @ 是键盘加速器。
  // 两条都得验：主路径断了用户就彻底没法引用，加速器断了则是「老手觉得这功能不存在」。
  await win.keyboard.press('Escape') // 关掉素材选择器，别盖住描述框
  const editor = win.locator('.generation-canvas-v2-node__prompt-input')
  await clickOrFail(editor, '描述框')
  await win.keyboard.type('阳光下')
  await clickOrFail(composer.locator('[aria-label="角色参考1"]'), '参考 tile（主路径）')
  await expectVisible(editor.locator('[data-asset-mention] img'), '点 tile → 描述框插入带缩略图的引用 chip')
  record('点参考 tile → 描述框光标处插入引用 chip（可发现的主路径）')

  // ── 加速器：中文里**不打空格**直接打 @ → 唤起候选 → 再插一个 chip ──────────
  // 刻意**紧贴中文字符**打 @（「让@」），不给空格——中文写作本来就不打空格。
  // 上游 @tiptap/suggestion 的默认 allowedPrefixes: [' '] 会让这种最常见的写法静默不弹，
  // 等于把功能关掉；AssetMentionSuggestion 传 allowedPrefixes: null 关掉了那道检查。
  // 这条判据就是那个修复的回归闸：一旦有人把 null 改回默认，这里立刻报红。
  await win.keyboard.type('让')
  await win.keyboard.type('@')
  const mentionItems = win.locator('[data-mention-list="true"] [data-mention-item]')
  await expectVisible(mentionItems.first(), '中文字符后直接打 @（无空格）→ 弹出参考候选')
  await expect(mentionItems.first(), '已加的那张应当在「当前参考」组里').toHaveAttribute('data-mention-group', 'current')
  record('中文后直接打 @（无空格）→ 弹出参考候选，已加的那张归在「当前参考」组')
  await shot('mention-popup')

  await mentionItems.first().click()
  await expect(editor.locator('[data-asset-mention]'), '两条路径各插了一个 chip').toHaveCount(2)
  const chipProof = await proveProbe(editor.locator('[data-asset-mention]'), '描述框里确实插入了引用 chip')
  record('点候选 → 描述框光标处再插一个 @ 引用 chip（带 18px 缩略图）')
  await shot('mention-chip')

  // 删 tile → 描述框里指向它的 chip 同步消失（不留悬空引用）。
  await clickOrFail(composer.locator('button[aria-label^="移除"]'), '移除参考 tile')
  await expectAbsent(editor.locator('[data-asset-mention]'), {
    provenBy: chipProof,
    message: '删掉参考 tile 后，描述框里指向它的两个 chip 都应当同步消失',
  })
  await expectAbsent(slot('角色参考1'), { provenBy: addRefProof, message: '删掉后 tile 本身也该没了' })
  record('删参考 tile → 描述框里指向它的 chip 全部同步消失（无悬空引用）')

  // ── 生成参数面板：标量参数带标签 ─────────────────────────────────────────
  await clickOrFail(composer.locator('button[aria-label="生成参数"]'), '「生成参数」')
  await expectVisible(paramPanel, '生成参数面板打开')
  const resolution = paramPanel.locator('[role="radiogroup"][aria-label="清晰度"]')
  await expectVisible(resolution, '设置面板：标量参数带标签（清晰度…，修复『裸值无标签』）')
  await expect(resolution.locator('[role="radio"]'), '标准变体的清晰度应当是 480p/720p/1080p/4k')
    .toHaveText(['480p', '720p', '1080p', '4k'])
  record('生成参数面板：清晰度带标签，标准变体给全 4 档')
  await shot('params-standard')

  // 在标准变体下把「1080p 确实会出现」证明掉，下面切「快速」后的消失才有基线。
  const highResProof = await proveProbe(
    resolution.locator('[role="radio"]', { hasText: '1080p' }),
    '标准变体下清晰度确实有 1080p 档',
  )

  // ── 变体轴：切「快速」→ 清晰度收窄成 480/720 ──────────────────────────────
  await win.keyboard.press('Escape')
  const pickedVariant = await pickFromSelect('变体', (t) => t === '快速', '变体')
  await clickOrFail(composer.locator('button[aria-label="生成参数"]'), '「生成参数」（快速变体）')
  await expectVisible(paramPanel, '生成参数面板重新打开')
  await expect(resolution.locator('[role="radio"]'), '快速变体的清晰度应当只剩 480p/720p')
    .toHaveText(['480p', '720p'])
  await expectAbsent(resolution.locator('[role="radio"]', { hasText: '1080p' }), {
    provenBy: highResProof,
    message: '快速变体不该还能选 1080p（变体只收窄选项，存量越界值也会被夹回）',
  })
  record('切「快速」变体 → 清晰度收窄成 480/720，1080p 消失', pickedVariant)
  await shot('params-fast')

  // Seedance 有变体轴，先证明「变体」下拉测得到，好让下面 HappyHorse 的「没有变体」不是空话。
  const variantProof = await proveProbe(composer.locator('[aria-label="变体"]'), 'Seedance 2.0 确实有「变体」下拉')

  // ── 换 HappyHorse 1.0：另一套 4 模式真名，且它没有变体轴 ───────────────────
  await win.keyboard.press('Escape')
  const pickedHappy = await pickFromSelect('模型', (t) => t.startsWith('HappyHorse 1.0'), '模型')
  await expect(composer.locator('[aria-label="模型"]'), '模型芯片没变成 HappyHorse').toHaveText(/HappyHorse/)
  await expect(modeGroup.locator('button'), 'HappyHorse：4 个模式各用自己的真名')
    .toHaveText(['文生视频', '图生视频', '角色参考', '视频编辑'])
  await expectVisible(composer.getByText('纯文本生成'), 'HappyHorse：提示行显示当前模式说明')
  await expectAbsent(composer.locator('[aria-label="变体"]'), {
    provenBy: variantProof,
    message: 'HappyHorse 档案没声明 variants，不该出现「变体」下拉',
  })
  record('换 HappyHorse 1.0 → 换成它自己的 4 个模式真名，且无变体下拉', pickedHappy)
  await shot('happyhorse')

  console.log(`\n✅ 走查通过：${passed} 条判据 · 截图 ${path.relative(repoRoot, shotsDir)}/`)
} catch (error) {
  await shot('FAIL').catch(() => {})
  console.error(`\n${error?.message || error}`)
  await app.close().catch(() => {})
  process.exit(1)
} finally {
  await app.close().catch(() => {})
}
