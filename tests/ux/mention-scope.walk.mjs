// R13 走查 —— @ 引用范围扩展（SHUO backlog 第 5 项）。
// 用法：node tests/ux/mention-scope.walk.mjs。截图写入本次走查的隔离目录。
//
// 这一项最要命的不是「弹层里多了几行」，而是**选中之后有没有真的建立引用**。
// 所以核心断言是：@ 一个画布节点 → 画布上**真的多一条边** + chip 编号对得上，不是只在文本里留一句话。
import { launchNomiApp } from './_launchApp.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { require as tsxRequire } from 'tsx/cjs/api'
import { expect, screenshotSettled } from './_assert.mjs'
import { addCanvasNode, canvasFitView, canvasZoomStep, createBlankProject, nodeModelTrigger } from './_shell.mjs'
import { assertOutsideRepo } from './uiDriverOptions.mjs'
import { buildWorld } from './_world.mjs'
import { uiTextWith } from './full-walk/invariants.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'

const require = createRequire(import.meta.url)
const { clipReferenceName } = tsxRequire('../../src/workbench/assets/referenceNames.ts', import.meta.url)
const { createEdgeId } = tsxRequire('../../src/workbench/generationCanvas/model/graphOps.ts', import.meta.url)
const shotsDir = assertOutsideRepo(makeTempDir('nomi-mention-scope-evidence-'))
process.env.EVIDENCE_DIR = shotsDir
const tmpDir = makeTempDir('nomi-mention-scope-fixture-')

let n = 0
let passed = 0
const fail = []
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (ok) passed += 1
  else fail.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
async function snap(win, name) {
  n += 1
  await screenshotSettled(win, { path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) })
  console.log(`  · shot ${String(n).padStart(2, '0')}-${name}`)
}

// 两张真图当素材（不同颜色，肉眼能分辨谁是谁）
const FF = require('@ffmpeg-installer/ffmpeg').path
const pics = []
for (const [name, color] of [['ref-red', 'red'], ['ref-blue', 'blue']]) {
  const out = path.join(tmpDir, `${name}.png`)
  await new Promise((resolve, reject) => {
    const c = spawn(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:size=320x320`, '-frames:v', '1', out])
    c.on('error', reject)
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))))
  })
  pics.push(out)
}
console.log('  → 素材图:', pics.map((p) => path.basename(p)).join(', '))

const world = buildWorld({
  rootDir: tmpDir,
  builtinSeeds: false,
  projects: [],
  catalog: {
    vendors: [{ key: 'ux-local', name: 'UX Local', enabled: true, authType: 'none', providerKind: 'openai-compatible' }],
    models: [{
      vendorKey: 'ux-local', modelKey: 'gpt-image-2', labelZh: 'GPT Image 2', kind: 'image', enabled: true, selectable: true,
      meta: { archetypeId: 'gpt-image-2' },
    }],
  },
})
const run = await launchNomiApp({
  name: 'mention-scope',
  world,
  args: ['--no-proxy-server'],
  initialLocalStorage: {
    'nomi:locale:v1': 'zh-CN',
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
    'nomi-color-scheme': 'light',
  },
  settleMs: 0,
})
const { win } = run
try {
  await createBlankProject(win)
  const genTab = win.locator('[data-mode="generation"]')
  await genTab.click({ timeout: 5000 })
  await expect(genTab).toHaveAttribute('aria-current', 'page')
  const nodes = win.locator('.generation-canvas-v2-node[data-node-id]')
  await expect(win.locator('.generation-canvas-v2__stage')).toBeVisible()

  // 把两张图拖进画布（真实路径：从访达拖素材进来）
  const b64s = pics.map((p) => fs.readFileSync(p).toString('base64'))
  await win.evaluate(async (list) => {
    const dt = new DataTransfer()
    list.forEach((b64, i) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      dt.items.add(new File([bytes], `ref-${i}.png`, { type: 'image/png' }))
    })
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const rect = stage.getBoundingClientRect()
    const opts = { bubbles: true, cancelable: true, clientX: rect.left + 260, clientY: rect.top + 220, dataTransfer: dt }
    stage.dispatchEvent(new DragEvent('dragover', opts))
    stage.dispatchEvent(new DragEvent('drop', opts))
  }, b64s)
  await win.waitForTimeout(6000)
  await expect(nodes).toHaveCount(2)
  await snap(win, 'assets-imported')

  // 再加一个空图片节点当「目标」（要在它的提示词框里打 @）
  const importedIds = await nodes.evaluateAll(elements => elements.map(el => el.getAttribute('data-node-id')))
  await addCanvasNode(win, 'image')
  await expect(nodes).toHaveCount(3)
  const ids = await nodes.evaluateAll(elements => elements.map(el => el.getAttribute('data-node-id')))
  const [targetId] = ids.filter(id => !importedIds.includes(id))
  check('画布上有 2 张素材 + 1 个目标节点', importedIds.every(id => ids.includes(id)) && Boolean(targetId), `实得 ${ids.length}`)

  await canvasFitView(win)
  const target = nodes.and(win.locator(`[data-node-id="${targetId}"]`))
  if (await target.getAttribute('data-selected') !== 'true') await target.click({ position: { x: 8, y: 8 } })
  const editor = target.locator('[data-node-composer-prompt] [data-prompt-box] [contenteditable="true"]')
  await expect(editor).toBeVisible()
  check('选中目标后提示词框出现', await editor.count() === 1)
  for (let step = 0; step < 6; step += 1) {
    // Playwright 的 visible 包含 viewport 外的元素。先证编辑器真能接收鼠标。
    if (await editor.click({ trial: true, timeout: 650 }).then(() => true, () => false)) break
    await canvasZoomStep(win, 'out', '缩小画布露出目标节点的提示词框')
  }
  await expect(nodeModelTrigger(win)).toContainText('GPT Image 2')
  await editor.click({ timeout: 8000 })
  check('找得到 composer 里那个可见的提示词框', await editor.evaluate(el => el.contains(document.activeElement)))
  await snap(win, 'target-selected')
  await win.keyboard.type('女主站在天台边 @')
  await expect(win.locator('[data-mention-list]')).toBeVisible()
  await snap(win, 'mention-open')

  const popup = await win.evaluate(() => {
    const list = document.querySelector('[data-mention-list]')
    if (!list) return null
    return {
      groups: Array.from(list.querySelectorAll('[data-mention-group]')).map((el) => el.getAttribute('data-mention-group')),
      labels: Array.from(list.querySelectorAll('[data-mention-item]')).map((el) => el.getAttribute('aria-label')),
      headers: Array.from(list.children).filter((el) => el.tagName === 'DIV').map((el) => el.textContent?.trim()),
    }
  })
  console.log('  → 弹层:', JSON.stringify(popup))
  check('@ 弹层出来了', Boolean(popup))
  check('画布上已出图的节点进了候选（扩展前根本没有这一组）',
    (popup?.groups || []).every((group) => group === 'canvas') && popup?.groups.length === 2, JSON.stringify(popup?.groups))
  check('候选按组标了来源', (popup?.headers || []).some((h) => h === '画布'), JSON.stringify(popup?.headers))

  // 打字过滤
  await win.keyboard.type('ref-1')
  await expect(win.locator('[data-mention-item]')).toHaveCount(1)
  const filtered = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-mention-item]')).map((el) => el.getAttribute('aria-label')))
  console.log('  → 过滤后:', JSON.stringify(filtered))
  check('打字能过滤（旧版 query 根本不参与过滤）', filtered.length > 0 && filtered.length < 2, JSON.stringify(filtered))
  await snap(win, 'mention-filtered')

  // 选中 → 必须**真的建一条边**
  const edgesBefore = await win.evaluate(() => document.querySelectorAll('.generation-canvas-v2__edge-path').length)
  const candidate = win.locator('[data-mention-item][data-mention-group="canvas"]')
  const sourceId = (await candidate.getAttribute('data-mention-item')).slice('canvas:'.length)
  const sourceName = await candidate.getAttribute('aria-label')
  await win.locator('[data-mention-item]').first().click({ timeout: 5000 })
  await expect(editor.locator('[data-asset-mention]')).toHaveCount(1)
  await expect(win.locator('.generation-canvas-v2__edge-path')).toHaveCount(edgesBefore + 1)
  const edge = win.locator(`g[data-edge-id="${createEdgeId(sourceId, targetId)}"]`)
  await expect(edge).toBeAttached()
  const after = await editor.evaluate((element) => ({
    edges: document.querySelectorAll('.generation-canvas-v2__edge-path').length,
    chips: Array.from(element.querySelectorAll('[data-asset-mention]')).map(el => el.textContent?.trim()),
    prompt: element.textContent?.trim() ?? '',
  }))
  console.log('  → 选中后:', JSON.stringify(after), `(之前 ${edgesBefore} 条边)`)
  check('@ 一个画布节点 → 画布上真的多了一条边（不是只在文本里留句话）',
    after.edges - edgesBefore === 1, `实得 ${after.edges - edgesBefore}`)
  check('插入了 chip', (after.chips || []).length === 1, JSON.stringify(after.chips))
  await expect(editor.locator('[data-asset-mention]')).toHaveText(clipReferenceName(sourceName))
  // B3 的正文 chip 显示素材名；重新打开 @ 时，「当前参考」组仍显示编号。
  await editor.press('End')
  await win.keyboard.type(' @')
  const current = win.locator('[data-mention-item][data-mention-group="current"]')
  await expect(current).toHaveCount(1)
  await expect(current).toHaveAttribute('aria-label', sourceName)
  const firstImage = uiTextWith('zh-CN', 'assetLibrary.referenceImageIndexed', { index: 1 })
  await expect(current).toContainText(firstImage)
  check('选中的来源是第 1 张图片参考，正文 chip 保留其素材名', true)
  await snap(win, 'current-reference-number')
  await win.keyboard.press('Escape')
  await snap(win, 'after-select')
} catch (error) {
  await snap(win, 'failed').catch(() => {})
  throw error
} finally {
  await run.close()
}
console.log(fail.length ? `\n❌ ${fail.length} 条不达标:\n - ${fail.join('\n - ')}` : `\n✅ 全部 ${passed} 项达标`)
process.exitCode = fail.length ? 1 : 0
