import { makeTempDir } from '../../scripts/_test-temp.mjs'
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
import { DEFAULT_TIMEOUT_MS, expect, expectVisible, proveProbe, clickOrFail, screenshotSettled } from './_assert.mjs'
import { canvasAddBar, newProjectEntry } from './_shell.mjs'
import { modeName, openModeMenu, closeModeMenu, readModeCell } from './_modeMenu.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/reference-companion-required')
// 每次跑清空产出：上一轮的 PNG 留在盘里会被当成这一轮的产出去对账（眼见链的第一个坑）。
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = makeTempDir('nomi-companion-')
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
  await screenshotSettled(win, { path: path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${tag}.png`) })
}

const composer = win.locator('.generation-canvas-v2-node__composer')
// 方式在底栏方式格（2026-11-12 起按输入现算，面板里不再有「生成方式」）；名字按词典键取。
const REFERENCE = modeName('zh', 'reference')
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
  // 「+」：空节点上是参考入口的 AssetAddTile，已有参考时是参考行的加号（同名的另一颗是「在画布上点选」，别点它）。
  await clickOrFail(composer.locator('button[data-reference-add-entry], button[data-asset-add-tile]').first(), `参考的「+」（${humanLabel}）`)
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

  // ── 进场：新建空白项目 → 生成画布 → 视频节点 → Seedance 2.0 ──────────────
  await clickOrFail(newProjectEntry(win), '新建空白项目')
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }), '顶栏「生成」')
  await expectVisible(canvasAddBar(win), '生成画布工具栏出现')
  await clickOrFail(canvasAddBar(win).locator('button[data-node-kind="video"]'), '工具条「视频」')
  await expectVisible(composer, '视频节点的浮动 composer 出现')

  const pickedModel = await pickFromSelect('模型', (t) => t.startsWith('Seedance 2.0'), '模型')
  await expect(composer.locator('[aria-label="模型"]'), '模型芯片没变成 Seedance 2.0').toHaveText(/Seedance 2\.0/)
  record('进场：新建项目 → 视频节点 → Seedance 2.0', pickedModel)

  // 先证探针活着：生成钮在这一屏确实找得到。
  // 否则后面「它是 disabled」的断言可能只是因为压根没找到这个元素（恒真的空话）。
  const buttonProof = await proveProbe(generateButton, '生成钮确实存在')
  record('探针基线：生成钮在这一屏找得到', buttonProof.label)

  // 基线（2026-11-12 起方式按输入现算）：一个参考都没有时方式是文生视频，全能参考在菜单里置灰——
  // 「空的全能参考」这个现场已经走不到了，所以不再验它那句泛化文案。
  const emptyMode = await readModeCell(composer, 'zh')
  if (emptyMode !== modeName('zh', 'text')) throw new Error(`WALK FAIL: 空节点的方式应是文生视频，实际「${emptyMode}」`)
  const emptyRows = await openModeMenu(win, composer, 'zh')
  await closeModeMenu(win)
  if (!emptyRows.find((row) => row.name === REFERENCE)?.disabled) throw new Error(`WALK FAIL: 一个参考都没有时「${REFERENCE}」应置灰：${JSON.stringify(emptyRows)}`)
  record('基线：空节点 → 方式格「文生视频」，全能参考置灰')
  await shot('empty-text-mode')

  // ── ① 只放一段参考音频 ────────────────────────────────────────────────
  const tmpWav = path.join(tempRoot, 'voice.wav')
  writeTinyWav(tmpWav)
  // 文生视频的空节点也有参考行：「+」给哪几类按「放进去之后收得下」现算（和拖进来同一个入口 addAssetUrlToNode），
  // 音频直接落进节点自己的参考音频格。2026-11-12 以前这里走建画布卡的旧入口，音频被拒「这个位置只收图片、视频」。
  await addReferenceFile(tmpWav, '音频')
  // 只有全能参考收音频：放进来后方式格自己换成它（不用人去点）。
  await expect.poll(() => readModeCell(composer, 'zh'), { message: `放了音频后方式格应自己换成「${REFERENCE}」`, timeout: DEFAULT_TIMEOUT_MS }).toBe(REFERENCE)
  await win.keyboard.press('Escape') // 接线已落地，关掉素材选择器，别盖住 composer
  record('往节点放入一段参考音频（且只有音频）→ 方式格自己换成全能参考')
  await shot('audio-only')

  // 断言前先证明「我确实在我以为的现场」：音频进去了、图和视频都还是空的。
  // 少了这一步，下面的置灰可能是别的原因（比如根本没上传成功 = 一个参考都没有）造成的。
  //
  // 参考行里每一格都带一颗移除钮（data-asset-tile-remove，悬停才露）：此刻正好一颗 = 只有音频那一格。
  // 先证这套定位器在这一屏找得到东西（_assert 的用法②），再数它——数出 1 才说明图 / 视频两槽是空的。
  const tileRemovers = composer.locator('[data-reference-block] [data-asset-tile-remove]')
  await proveProbe(tileRemovers, '同屏对照：参考行里至少有音频那一格')
  await expect(tileRemovers, '这一刻参考行里应只有音频那一格——否则验的就不是"纯音频"了').toHaveCount(1)
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
  await expect(tileRemovers, '上传后参考行应多出图那一格（音频 + 图 = 两格）').toHaveCount(2)
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
