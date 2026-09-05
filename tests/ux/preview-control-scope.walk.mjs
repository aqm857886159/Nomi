// R13 走查：剪辑面「作用域」的真机取证。零额度——只用本地 ffmpeg 造的色块图，绝不触发任何生成。
//
// 2026-08-03 首版验的是**预览控制条**分成 4 个带名字的作用域组。2026-09-05 剪辑面合同 §2.2
// 把作用域整体搬了家：控制条退回纯 transport（播放 / 步帧 / 时码 / 叠加 / 音量 / 全屏），
// 「整片」与「这一段」的值去了属性面板、动作留在时间轴工具条。所以本走查跟着搬，验的是同一件事
// 在**新家**成立，而不是把旧控件加回控制条：
//   ① transport 里不再有任何作用域组（没有 data-control-scope="clip"/"film"）
//   ② 没选中时，时间轴「这一段」工具组整组禁用且说得出原因
//   ③ 选中一个片段后解禁，且属性面板从「整片」切到该片段（写出对象名与类型）
// 断言用属性/几何，不靠人眼——人眼看静态截图恰恰看不出「作用域跟着谁走」。
import { launchNomiApp } from './_launchApp.mjs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, 'docs/design/mockups/2026-08-03-scope-after')
fs.mkdirSync(outDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-scope-walk-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const stills = ['0x2E6E6B', '0xE8A33D'].map((color, i) => {
  const out = path.join(root, `still-${i}.png`)
  const run = spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360`, '-frames:v', '1', out])
  if (run.status !== 0) throw new Error(`夹具编码失败: ${run.stderr?.toString().slice(-300)}`)
  return out
})

const { app, win: _win } = await launchNomiApp({
  name: 'preview-control-scope',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let win = _win
const getWin = () => {
  const live = app.windows().filter((w) => !w.isClosed())
  win = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}
const resize = async () => {
  const bw = await app.browserWindow(getWin())
  await bw.evaluate((w, s) => { w.setBounds({ x: 0, y: 0, ...s }); w.center() }, { width: 1680, height: 1050 })
  await getWin().waitForTimeout(400)
}
const snap = async (name) => {
  const p = path.join(outDir, name)
  await screenshotSettled(getWin(), { path: p })
  console.log(`  · 截图 ${name} — ${(fs.statSync(p).size / 1024).toFixed(0)}KB`)
}
/** 只截控制条那一条（组名/禁用态在整屏图上看不清）。 */
const snapBar = async (name) => {
  const box = await getWin().evaluate(() => {
    const bar = document.querySelector('.workbench-preview-player__control-bar')
    if (!bar) return null
    const r = bar.getBoundingClientRect()
    return { x: Math.max(0, r.x - 20), y: Math.max(0, r.y - 20), width: Math.min(1680, r.width + 40), height: r.height + 40 }
  })
  if (!box) { console.log(`  · ${name} 跳过：没找到控制条`); return }
  await screenshotSettled(getWin(), { path: path.join(outDir, name), clip: box })
  console.log(`  · 截图 ${name}`)
}
/** 读 transport 各组：合同要求这里只剩 transport / overlay 两组，没有片段/整片作用域。 */
const readGroups = () => getWin().evaluate(() => {
  const bar = document.querySelector('.workbench-preview-player__control-bar')
  if (!bar) return null
  return [...bar.querySelectorAll('.workbench-preview-player__control-group')].map((g) => {
    const label = g.getAttribute('aria-label') || ''
    const scope = g.getAttribute('data-control-scope') || ''
    const controls = [...g.querySelectorAll('button, input, select, [role="button"]')]
    const disabledCount = controls.filter((c) => c.disabled === true || c.getAttribute('aria-disabled') === 'true').length
    return { label, scope, controls: controls.length, disabledCount }
  })
})

/** 属性面板当前对着谁：整片 / 视频片段 / 图片片段 / 字幕。 */
const readInspector = () => getWin().evaluate(() => {
  const row = document.querySelector('[data-testid="preview-inspector-object"]')
  if (!row) return null
  const groups = [...document.querySelectorAll('[aria-label="属性面板"] section > button')].map((b) => b.textContent?.trim() || '')
  return { objectType: row.getAttribute('data-object-type') || '', text: row.textContent?.trim() || '', groups }
})

win.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 160)}`))

const readClipTools = () => getWin().evaluate(() => {
    // 两套 TimelinePanel 实例：其中一份零宽/隐藏，只认真实渲染的那份
    const box = [...document.querySelectorAll('.workbench-timeline__clip-tools')]
      .find((el) => el.getBoundingClientRect().width > 0)
    if (!box) return null
    const btns = [...box.querySelectorAll('button')]
    // 「这一段」现在是一个 ControlGroup：禁用整组时原因挂在**组自己的外层 <span title>** 上
    // （禁用的 button 不触发自己的 title）。那个 span 在 .workbench-timeline__clip-tools **里面**，
    // 不是它的 parentElement——#508 把工具条改成带 legend 的分组框后层级变了。
    return {
      count: btns.length,
      disabled: btns.filter((b) => b.disabled).length,
      reason: box.querySelector('[title]')?.getAttribute('title') || box.parentElement?.getAttribute('title') || '',
      width: Math.round(box.getBoundingClientRect().width),
    }
  })

const verdicts = []
const check = (name, ok, detail = '') => { verdicts.push([name, ok, detail]); console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`) }

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2200)
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)
  await resize()
  for (let i = 0; i < 5; i++) {
    const skip = getWin().locator('button:has-text("跳过")').first()
    if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 800 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(200)
  }

  await getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first().click({ timeout: 8000 }).catch(() => {})
  await getWin().waitForTimeout(3000)
  for (let i = 0; i < 5; i++) { await getWin().keyboard.press('Escape').catch(() => {}); await getWin().waitForTimeout(180) }
  await resize()

  // 画布投两张真图 → 变成两个节点（proven 流：运行时真拖放，不靠播种）
  await getWin().getByRole('button', { name: '生成', exact: false }).first().click({ timeout: 5000 }).catch(() => {})
  await getWin().waitForTimeout(1500)
  const b64 = stills.map((p) => fs.readFileSync(p).toString('base64'))
  await getWin().evaluate(async (pngs) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    pngs.forEach((b, i) => {
      const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], `still-${i}.png`, { type: 'image/png' }))
      const opts = { bubbles: true, cancelable: true, clientX: rect.x + 260 + i * 320, clientY: rect.y + 240, dataTransfer: dt }
      stage.dispatchEvent(new DragEvent('dragover', opts))
      stage.dispatchEvent(new DragEvent('drop', opts))
    })
  }, b64)
  await getWin().waitForTimeout(4500)
  console.log(`  · 画布节点数 ${await getWin().evaluate(() => document.querySelectorAll('[data-node-id]').length)}`)

  // 进预览页，点源面板缩略图把两个镜头贴进时间轴
  await getWin().getByRole('button', { name: '预览', exact: false }).first().click({ timeout: 5000 }).catch(() => {})
  await getWin().waitForTimeout(2500)
  await resize()
  // ========== ① 没有可编辑目标时：「这一段」整组必须禁用且说得出原因 ==========
  // 放在往时间轴加片段**之前**——此刻时间轴是空的，是确定性的「无目标」状态。
  // （从源面板加片段会自动选中刚加的那个，加完再测就不是空选了。）
  await getWin().waitForTimeout(600)
  const idle = await readGroups()
  console.log('  · transport 各组：', JSON.stringify(idle))
  const scopes = (idle || []).map((g) => g.scope)
  check('transport 已渲染', (idle || []).length > 0, `实际 ${(idle || []).length} 组`)
  check('transport 里不再有作用域组（画幅/缩放已迁属性面板）', !scopes.includes('clip') && !scopes.includes('film'), scopes.join(',') || '无')
  const inspectorIdle = await readInspector()
  check('无选中时属性面板显示整片', inspectorIdle?.objectType === 'film', JSON.stringify(inspectorIdle))
  const idleTools = await readClipTools()
  // 3 颗（分割 / 复制 / 删除），不是 4：#508 把「重新生成」撤出常驻工具条，进右键菜单。
  check('无选中时单片工具整组禁用', (idleTools?.count ?? 0) > 0 && idleTools.disabled === idleTools.count, `${idleTools?.disabled}/${idleTools?.count} 禁用`)
  check('无选中时说得出原因', Boolean(idleTools?.reason), idleTools?.reason || '无 title')
  await snapBar('01-bar-no-target.png')

  // 源面板可能是收起的，先展开（收起态那颗钮的 aria-label 里有「素材来源」）
  const expander = getWin().locator('[aria-label*="展开"], [title*="展开"]').first()
  if (await expander.count()) await expander.click({ timeout: 2000 }).catch(() => {})
  await getWin().waitForTimeout(700)
  // 真实 aria-label = `{{name}} · 拖到轨道放这里，点击加到片尾`
  const tiles = getWin().locator('[aria-label*="点击加到片尾"]')
  const tileCount = await tiles.count()
  for (let i = 0; i < Math.min(tileCount, 2); i++) {
    await tiles.nth(i).click({ timeout: 3000 }).catch(() => {})
    await getWin().waitForTimeout(900)
  }
  // 只认**真实渲染**那份：时间轴挂着两套 TimelinePanel 实例，另一份宽高为 0（同 readClipTools 的过滤）。
  // 不加 :visible 时 .first() 会落在那份零宽的隐身 clip 上，Playwright 等它可交互直到超时——
  // 点击**根本没落下**，于是「点了没选中」看起来像产品 bug，实则一次都没点到。
  const visibleClips = getWin().locator('[data-testid="timeline-clip"]:visible')
  const clipCount = await visibleClips.count()
  console.log(`  · 源面板缩略图 ${tileCount} 个 / 时间轴片段 ${clipCount} 个（可见）`)


  // ========== ② 选中一个片段：组亮起 + 写出片段名 ==========
  await visibleClips.first().click({ timeout: 5000 })
  await getWin().waitForTimeout(900)
  const inspectorSel = await readInspector()
  console.log('  · 选中后属性面板：', JSON.stringify(inspectorSel))
  const selectedNodes = await getWin().locator('[data-testid="timeline-clip"][data-selected="true"]:visible').count()
  check('点击后时间轴出现选中态', selectedNodes >= 1, `data-selected 元素 ${selectedNodes} 个（可见实例）`)
  check('属性面板从整片切到该片段（作用对象可见）', inspectorSel?.objectType === 'video' || inspectorSel?.objectType === 'image',
    inspectorSel?.objectType || '无')
  check('片段态出「显示 / 时间」两组（组序固定）', (inspectorSel?.groups || []).slice(0, 2).join('/') === '显示/时间',
    (inspectorSel?.groups || []).join('/'))
  await snapBar('02-bar-clip-selected.png')

  // ========== ③ 单片工具：恒常渲染、无选中时禁用带原因（原先是有选中才插入 → 整条 pill 变长、布局抖） ==========
  const withSel = await readClipTools()
  check('单片工具恒常渲染（3 颗：分割 / 复制 / 删除）', withSel?.count === 3, JSON.stringify(withSel))
  check('选中片段时可用', withSel?.disabled === 0, `${withSel?.disabled}/${withSel?.count} 禁用`)
  check('工具条宽度恒定（不再一选中就抖）', idleTools && withSel && idleTools.width === withSel.width,
    `${idleTools?.width}px → ${withSel?.width}px`)

  await snap('03-preview-full.png')

  console.log('\n=== 判据 ===')
  const failed = verdicts.filter(([, ok]) => !ok).length
  for (const [name, ok, detail] of verdicts) console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`\n截图目录：${outDir}`)
  process.exitCode = failed ? 1 : 0
} catch (error) {
  console.error('走查失败:', error)
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
