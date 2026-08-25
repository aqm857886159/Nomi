// 穿透走查（规则 13）—— 跨槽依赖：Seedance 2.0 的参考音频不能单独用。**零额度**（全程不点生成）。
//
// 覆盖的真实缺陷（2026-08-20）：omni 模式只放一段参考音频时，`canRunGenerationNode` 此前只问
// 「任一数组槽非空」→ 判定可生成 → 生成钮亮着 → 用户点下去，钱花了、请求被服务商拒。
// 三家官方文档一致：
//   火山方舟 https://docs.volcengine.com/docs/82379/2291680 「注意不支持"文本+音频"、"纯音频" 输入」
//   APIMart  "Must be used together with reference images or reference videos"
//   fal      "requires at least one image or video"
// （Seedance 2.5 已解除此限，故做成档案声明 slot.requiresAnyOf，不是写死的 if。）
//
// 这份走查验的是**用户真能看见的那一层**，不是断言函数返回值：
//   ① 只放音频 → 生成钮**真的**置灰（disabled 属性）；
//   ② 置灰时鼠标悬停给的原因**说人话且说得具体**——「参考音频不能单独使用，还需要角色参考或参考视频」，
//      而不是泛泛的「需要先添加参考素材」（用户明明加了音频，那句话会把人往沟里带）；
//   ③ 补一张图 → 立刻可生成（约束是"缺伴随"，不是"音频有毒"）。
//
// 用法：pnpm run build && node tests/ux/reference-companion-required.walk.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, expectAbsent, proveProbe, clickOrFail, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/reference-companion-required')
// 每次跑清空产出：上一轮的 PNG 留在盘里会被当成这一轮的产出去对账（眼见链的第一个坑）。
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-companion-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
fs.mkdirSync(projectsDir, { recursive: true })

/** 最小合法 WAV（44 字节头 + 一点 PCM）。真文件，走真上传管线，不是 stub。 */
function writeTinyWav(target) {
  const samples = 800 // 8kHz 单声道 16bit ≈ 0.1s
  const data = Buffer.alloc(samples * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(16000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  fs.writeFileSync(target, Buffer.concat([header, data]))
}

const { app, win } = await launchNomiApp({
  name: 'reference-companion-required',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
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
  await screenshotSettled(win, { path: path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${tag}.png`) })
}

const composer = win.locator('.generation-canvas-v2-node__composer')
const modeGroup = composer.locator('[role="group"][aria-label="生成方式"]')
const activeMode = modeGroup.locator('button[aria-pressed="true"]')
/**
 * 参考 tile 的存在性锚点 = 它的「移除」按钮（`移除参考音频1` / `移除角色参考1`）。
 * **不用 tile 自身的 aria-label**：只有 characterIndexed 的角色图 tile 才带（要支持拖拽重排），
 * 音频 tile 根本没有那个属性 —— 探真实 DOM 才发现的，照角色图的写法猜必然找不到（本轮已栽过一次）。
 */
const tile = (label) => composer.locator(`button[aria-label="移除${label}"]`)
/** 生成钮本体（原生 button），以及包着它、承载悬停原因的那层 span[title]。 */
const generateButton = composer.locator('button[aria-label="生成素材"]')
// 原因挂在**包着**生成钮的那层 span 的 title 上（悬停时用户看到的就是它），不在按钮自己身上。
const generateTitle = composer.locator('span[title]:has(button[aria-label="生成素材"])')

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

/** 经素材选择器上传一个本地文件到当前节点的参考槽（与 archetype-modebar 同一条真实路径）。 */
async function addReferenceFile(filePath, humanLabel) {
  await clickOrFail(composer.locator('button[aria-label="加参考"]'), `omni 的「加参考」（${humanLabel}）`)
  // 素材选择器里有两个 file input，只有带 aria-label 的那个是「上传本地文件」入口；挑错了会静默什么都不发生。
  await win.locator('input[type="file"][aria-label="上传本地文件"]').first().setInputFiles(filePath)
}

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)

  // 占位 key：只为让 Seedance 2.0 进目录。全程不点生成 → 零额度。
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

  // ── 进场：新建空白项目 → 生成画布 → 视频节点 → Seedance 2.0 → 全能参考 ──────
  await clickOrFail(win.locator('button, [role="button"]', { hasText: '新建空白项目' }), '新建空白项目')
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }), '顶栏「生成」')
  await expectVisible(win.locator('.generation-canvas-v2-toolbar'), '生成画布工具栏出现')
  await clickOrFail(win.locator('.generation-canvas-v2-toolbar button[data-node-kind="video"]'), '工具条「视频」')
  await expectVisible(composer, '视频节点的浮动 composer 出现')

  const pickedModel = await pickFromSelect('模型', (t) => t.startsWith('Seedance 2.0'), '模型')
  await expect(composer.locator('[aria-label="模型"]'), '模型芯片没变成 Seedance 2.0').toHaveText(/Seedance 2\.0/)
  await clickOrFail(modeGroup.locator('button', { hasText: '全能参考' }), '模式「全能参考」')
  await expect(activeMode, '点了「全能参考」但分段条的选中项没换过去').toHaveText('全能参考')
  record('进场：新建项目 → 视频节点 → Seedance 2.0 → 全能参考', pickedModel)
  await shot('omni-empty')

  // 先证探针活着：生成钮在这一屏确实找得到。
  // 否则后面「它是 disabled」的断言可能只是因为压根没找到这个元素（恒真的空话）。
  const buttonProof = await proveProbe(generateButton, '全能参考模式下生成钮确实存在')
  record('探针基线：生成钮在这一屏找得到', buttonProof.label)

  // 基线：**一个参考都没有**的 omni 走的仍是原来那句泛化文案。
  // 这条钉的是「新约束没有把老路径吃掉」——具体原因只该在它真的适用时替换掉泛化原因。
  // （顺带：这也是本轮唯一靠肉眼看截图分辨不出来的一处——置灰与否在缩略图上几乎同色，
  //   所以改成机器断言，别用"我看着像"结账。）
  await expect(generateButton, '空 omni 本就该置灰（一个参考都没有）').toBeDisabled()
  await expect(generateTitle, '空 omni 的原因应当是原来那句泛化文案，不该被新约束顶掉')
    .toHaveAttribute('title', '需要先添加参考素材（拖入 / 连线 / 点 +）')
  record('基线：空 omni → 置灰 + 泛化文案「需要先添加参考素材」')

  // ── ① 只放一段参考音频 ────────────────────────────────────────────────
  const tmpWav = path.join(tempRoot, 'voice.wav')
  writeTinyWav(tmpWav)
  await addReferenceFile(tmpWav, '音频')
  await expectVisible(tile('参考音频1'), '上传后参考音频 tile 出现（音频真的进了 audio_ref 槽）')
  await win.keyboard.press('Escape') // 关掉素材选择器，别盖住 composer
  record('往 omni 放入一段参考音频（且只有音频）')
  await shot('audio-only')

  // 断言前先证明「我确实在我以为的现场」：音频进去了、图和视频都还是空的。
  // 少了这一步，下面的置灰可能是别的原因（比如根本没上传成功 = 一个参考都没有）造成的。
  //
  // 用同屏对照物证探针（_assert 的用法②）：`移除X` 这套定位器**在这一屏确实找得到东西**
  // ——音频 tile 的移除钮就在那。证过之后，「找不到角色参考/参考视频」才是真的没有，
  // 而不是"这套选择器在本屏根本不生效"。
  const removeProbeAlive = await proveProbe(tile('参考音频1'), '同屏对照：`移除…` 这套探针在本屏是活的')
  await expectAbsent(tile('角色参考1'), {
    provenBy: removeProbeAlive,
    message: '这一刻不该有任何角色参考图——否则验的就不是"纯音频"了',
  })
  await expectAbsent(tile('参考视频1'), {
    provenBy: removeProbeAlive,
    message: '这一刻不该有任何参考视频——否则验的就不是"纯音频"了',
  })
  record('现场确认：音频已入槽，图/视频两槽都是空的（验的确实是"纯音频"）')

  // ② 生成钮必须置灰
  await expect(generateButton, '只放参考音频时生成钮仍可点 → 用户会付费发出一个必被拒的请求').toBeDisabled()
  record('只放参考音频 → 生成钮置灰')

  // ③ 悬停原因要说人话、且说得**具体**（不是泛泛的「需要先添加参考素材」）
  await expect(generateTitle, '置灰了却不给具体原因，用户只能干瞪眼')
    .toHaveAttribute('title', '参考音频不能单独使用，还需要角色参考或参考视频')
  record('置灰原因说人话且具体：「参考音频不能单独使用，还需要角色参考或参考视频」')
  await shot('audio-only-disabled')

  // ── ④ 补一张图 → 依赖满足，立刻可生成 ─────────────────────────────────
  // 这一条是"约束是否修得太狠"的反向保险：拦的是**缺伴随**，不是"有音频就不许生成"。
  const tmpPng = path.join(tempRoot, 'char1.png')
  fs.writeFileSync(
    tmpPng,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
  )
  await addReferenceFile(tmpPng, '图片')
  await expectVisible(tile('角色参考1'), '上传后角色图 tile 出现')
  await win.keyboard.press('Escape')
  await expect(generateButton, '音频 + 图片已凑齐，生成钮却还灰着 → 约束修过头了').toBeEnabled()
  record('补一张角色参考图 → 依赖满足，生成钮立刻恢复可点')
  await shot('audio-plus-image-enabled')

  console.log(`\n✅ reference-companion-required 走查通过（${passed} 条）`)
  console.log(`   截图：${path.relative(repoRoot, shotsDir)}`)
} catch (error) {
  await shot('failure')
  console.error('\n❌ 走查失败：', error?.message || error)
  process.exitCode = 1
} finally {
  await app.close()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
