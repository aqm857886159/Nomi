// R16 真实用户任务走查（应用内完整闭环）：剧本 → 拆镜头 → 落画布 → 逐镜真出图 → 排时间轴出初稿。
// 全程走**真实 UI**（用户点的那些按钮），不 stub agent/模型：创作区点「拆成镜头·落画布」→ 规划师(真文本大脑)
// 出方案 → 分镜页 footer「生成未生成的 N 镜」→ 按需 materialize 落节点(定妆卡+镜头) → 付费确认 → 真出图(依赖波次
// 参考先→镜头后) → 让画布助手把镜头排到时间轴 → 预览区看初稿。每步 getWin().screenshot 供人眼复核(眼见链)。
//
// **会花真实图额度**（图片分镜，默认档，最省）。额度闸：不显式 NOMI_R16_GEN=1 就 SKIP。
// 用法：pnpm run build && NOMI_R16_GEN=1 node tests/ux/draft-loop.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/draft-loop')

if (!process.env.NOMI_R16_GEN) {
  console.log('SKIP draft-loop.walk: 会花真实图额度。NOMI_R16_GEN=1 node tests/ux/draft-loop.walk.mjs 才跑（用 app 已连图片+文本模型）。')
  process.exit(0)
}

fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

// 隔离 userData（不撞真实运行实例/项目），拷真 model-catalog.json 复用已连模型 + safeStorage key。
const realSettings = process.env.NOMI_SETTINGS_DIR || path.join(os.homedir(), 'Library/Application Support/Nomi')
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-draftloop-'))
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })
const realCat = path.join(realSettings, 'model-catalog.json')
if (!fs.existsSync(realCat)) { console.log(`SKIP: 找不到真 model-catalog.json（${realCat}）——app 里接图片+文本模型再跑。`); process.exit(0) }
fs.copyFileSync(realCat, path.join(settingsDir, 'model-catalog.json'))

// 一段有台词+动作+运镜的真戏（给规划师足够材料，控制在少量镜头以省额度/时间）。
const STORY =
  '深夜面馆。老陈盯着空荡的店面，慢慢擦着桌子。门帘一挑，多年未见的女儿走进来。' +
  '老陈手一顿，抬头，声音发颤：「你……回来了。」女儿站在门口没动，眼眶红了。'
const projectId = 'draftloop-0001'
const projDir = path.join(projectsDir, `draftloop-${projectId}`)
fs.mkdirSync(path.join(projDir, '.nomi'), { recursive: true })
const workbenchDocument = {
  version: 1, title: '深夜面馆', updatedAt: 1,
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: STORY }] }] },
}
const project = {
  id: projectId, name: '深夜面馆·初稿闭环', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  payload: {
    workbenchDocument, timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projDir, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

let n = 0
const snap = async (win, name) => {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await win.screenshot({ path: path.join(shotsDir, `${tag}.png`) }).catch((e) => console.log(`  (snap ${tag} failed: ${e.message})`))
  console.log(`  · shot ${tag}`)
}
const bodyText = (win) => win.evaluate(() => document.body.innerText).catch(() => '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { app, win } = await launchNomiApp({
  name: 'draft-loop',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--disable-gpu', '--disable-software-rasterizer'],
  env: { NOMI_CAPABILITY_DIR: path.join(settingsDir, 'capability-core') },
})

let exitCode = 0
try {
  win.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)))
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await sleep(1500)
  for (let i = 0; i < 6; i++) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first()
    if (await skip.count()) await skip.click({ timeout: 1000 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await sleep(300)
  }
  await snap(win, 'library')

  // ── Stage 1: 打开项目 → 创作区 ────────────────────────────────
  const inProject = async () => win.evaluate(() => !/Nomi 项目库|新建空白项目/.test(document.body.innerText))
  const card = win.getByText('深夜面馆·初稿闭环', { exact: false }).first()
  if (await card.count()) {
    const box = await card.boundingBox().catch(() => null)
    if (box) {
      const cx = box.x + box.width / 2
      const cy = Math.max(box.y - 40, box.y - 80)
      await win.mouse.move(cx, cy).catch(() => {})
      await sleep(400)
      await win.mouse.click(cx, cy).catch(() => {})
      await sleep(2500)
    }
    if (!(await inProject())) { await card.dblclick({ force: true, timeout: 3000 }).catch(() => {}); await sleep(2500) }
  }
  if (!(await inProject())) { console.log('✗ 打不开项目'); throw new Error('cannot open project') }
  const creationTab = win.locator('button,[role="button"]', { hasText: /^创作$/ }).first()
  if (await creationTab.count()) { await creationTab.click({ timeout: 3000 }).catch(() => {}); await sleep(1200) }
  await snap(win, 'creation-area')

  // ── Stage 2: 拆镜头（图片分镜默认）→ 规划师出方案 ─────────────
  const runStoryboard = win.locator('[data-action-run="storyboard"]').first()
  console.log('  拆镜头按钮 count:', await runStoryboard.count())
  if (!(await runStoryboard.count())) { await snap(win, 'no-storyboard-button'); throw new Error('无拆镜头入口') }
  await runStoryboard.click({ timeout: 3000 }).catch(() => {})
  console.log('  · 已点「拆成镜头·落画布」，等规划师(真文本大脑)出方案…')
  // 真「方案就绪」信号 = 中列方案摘要卡渲出「打开分镜」按钮（v5：完整编辑器住分镜页，执行面在表内）。
  // 不用宽松关键词（会误命中「正在整理分镜方案…」loading 文案 → 2026-08-02 首跑踩过）。真模型可能慢，给足 180s。
  const openStoryboard = win.locator('button', { hasText: /打开分镜/ }).first()
  let planReady = false
  for (let i = 0; i < 180; i++) {
    if (await openStoryboard.count()) { planReady = true; break }
    const txt = await bodyText(win)
    if (/拆镜头失败|未接入该模型|模型未接入|规划失败|出错了/.test(txt) && i > 8) { console.log(`  ⚠ 规划师疑似报错：${txt.slice(0, 160)}`); break }
    if (i % 15 === 14) console.log(`    …规划师仍在跑（${i + 1}s）`)
    await sleep(1000)
  }
  await snap(win, 'storyboard-plan')
  console.log(`  · 方案摘要卡就绪 = ${planReady}`)
  const shotCountText = await win.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\s*个镜头|(\d+)\s*镜/)
    return m ? m[0] : '(未读到镜头数)'
  }).catch(() => '(读取失败)')
  console.log(`  · 方案镜头数线索：${shotCountText}`)
  if (!planReady) throw new Error('规划师未在 180s 内产出方案（看 storyboard-plan 截图 + 上面日志）')

  // ── Stage 3: 打开分镜页（v5 执行面：表内直接生成，节点按需长到画布）──
  await openStoryboard.click({ timeout: 3000 }).catch(() => {})
  await sleep(1500)
  await snap(win, 'storyboard-table')

  // ── Stage 4: footer「生成未生成的 N 镜」→ 付费确认 → 真出图 ──────────────
  const runAll = win.locator('[data-storyboard-batch="true"]').first()
  console.log('  批量生成按钮 count:', await runAll.count())
  if (!(await runAll.count())) { await snap(win, 'no-batch-button'); throw new Error('无「生成未生成的 N 镜」按钮') }
  await runAll.click({ timeout: 3000 }).catch(() => {})
  await sleep(1500)
  await snap(win, 'spend-confirm')
  // 付费确认对话框（z-[3500] 全屏模态，标题「开始生成」）→ 点确认（primary，最后一个按钮）。
  const spendDlg = win.locator('div.fixed.inset-0').filter({ hasText: /开始生成|会消耗模型额度|将生成/ }).first()
  if (await spendDlg.count()) {
    const confirmBtn = spendDlg.locator('button').last()
    console.log('  · 付费确认卡出现 → 点确认生成')
    await confirmBtn.click({ timeout: 3000 }).catch(() => {})
  } else {
    console.log('  ⚠ 未见付费确认卡（可能 light 已抑制 / 直接开跑）')
  }
  console.log('  · 生成中（依赖波次：参考先→镜头后）——轮询真资产落地，等整批完成…')

  // 轮询真资产：assets.list 里出现产物即算出图（比 DOM 稳）。等整批完成（含全部镜头）。
  // 真出图会撞供应商偶发超时（一个锚超时 → 引用它的镜头全被「上游未生成」挡下，级联卡住）——
  // 真实用户会点「重试」，走查照做：卡住(≥12s 不增)且有 重试 按钮就点，最多 4 轮。收敛/满额/封顶 6 分钟收。
  let assetCount = 0
  let stable = 0
  let prev = -1
  let retries = 0
  for (let i = 0; i < 90; i++) {
    await sleep(4000)
    assetCount = await win.evaluate(async (pid) => {
      try { const r = await window.nomiDesktop.assets.list({ projectId: pid, limit: 80 }); return (r?.items || []).length } catch { return -1 }
    }, projectId).catch(() => -1)
    stable = assetCount === prev ? stable + 1 : 0
    prev = assetCount
    if (i % 6 === 0) { console.log(`    …已落资产 ${assetCount} 个`); await snap(win, `gen-progress-${String(i).padStart(2, '0')}`) }
    if (assetCount >= 9) { console.log(`    整批基本完成（${assetCount} 个）`); break }
    // 卡住且有失败/受阻节点 → 点「重试」（模拟真实用户；供应商超时是偶发）。
    if (stable >= 3 && retries < 4) {
      const retryBtns = win.locator('button', { hasText: /^重试$/ })
      const cnt = await retryBtns.count()
      if (cnt > 0) {
        console.log(`    ⚠ 生成卡在 ${assetCount} 个，点 ${cnt} 个「重试」（第 ${retries + 1} 轮）`)
        for (let k = 0; k < Math.min(cnt, 12); k++) await retryBtns.nth(k).click({ timeout: 1500 }).catch(() => {})
        retries += 1; stable = 0
        await sleep(1200)
        // 重试可能再弹付费确认（若上次没勾「本会话不再提示」）→ 点确认。
        const dlg = win.locator('div.fixed.inset-0').filter({ hasText: /开始生成|会消耗模型额度|将生成/ }).first()
        if (await dlg.count()) await dlg.locator('button').last().click({ timeout: 2000 }).catch(() => {})
        continue
      }
    }
    if (assetCount >= 4 && stable >= 8) { console.log(`    资产数收敛于 ${assetCount}（部分镜头可能失败/被拦）`); break }
  }
  await sleep(3000)
  const finalAssets = await win.evaluate(async (pid) => {
    try { const r = await window.nomiDesktop.assets.list({ projectId: pid, limit: 50 }); return (r?.items || []).map((a) => `${a.kind || '?'}:${(a.id || '').slice(0, 8)}`) } catch (e) { return ['ERR ' + e.message] }
  }, projectId).catch(() => ['read-fail'])
  console.log(`  · 最终真资产 ${finalAssets.length} 个：${finalAssets.slice(0, 12).join(', ')}`)
  await snap(win, 'gen-done')

  // ── Stage 5: 排到时间轴（「AI 拼片」直连按钮，确定性排片、不经 LLM）─────
  // 主线诉求「点一下出初剪」= TimelinePanel 的 IconWand 按钮（aria-label「AI 拼片」），
  // 直调 arrangeStoryboardToTimeline（纯函数，按镜序追加）。切到预览区，全时间轴 + 工具条可见。
  const previewTab = win.locator('button,[role="button"]', { hasText: /^预览$/ }).first()
  if (await previewTab.count()) { await previewTab.click({ timeout: 3000 }).catch(() => {}); await sleep(2500) }
  await snap(win, 'preview-before-arrange')
  let timelineArranged = false
  const arrangeBtn = win.locator('[aria-label="AI 拼片"], [aria-label*="拼片"], button[title*="拼片"]').first()
  console.log('  「AI 拼片」按钮 count:', await arrangeBtn.count())
  if (await arrangeBtn.count()) {
    await arrangeBtn.click({ timeout: 3000 }).catch(() => {})
    await sleep(3500)
    timelineArranged = true
    console.log('  · 已点「AI 拼片」，镜头按镜序排进时间轴')
  } else {
    console.log('  ⚠ 未找到「AI 拼片」按钮（看 preview-before-arrange 截图确认工具条）')
  }
  await snap(win, 'timeline-arranged')

  // ── Stage 6: 看初稿（时间轴段数 + 播放头预览）────────────────
  const segText = await win.evaluate(() => {
    const m = document.body.innerText.match(/时间轴\s*(\d+)\s*段|(\d+)\s*段\s*·/)
    return m ? m[0] : '(未读到段数)'
  }).catch(() => '(读取失败)')
  console.log(`  · 时间轴：${segText}`)
  await snap(win, 'preview-draft')

  const ok = planReady && assetCount >= 1
  console.log(`\n═══ DRAFT-LOOP：方案=${planReady ? '✓' : '✗'} 真出图=${assetCount >= 1 ? `✓(${assetCount})` : '✗'} 排时间轴=${timelineArranged ? '✓' : '⚠'} ═══`)
  console.log(`  截图 → ${shotsDir}（人眼复核每步体验）`)
  if (!ok) exitCode = 1
} catch (err) {
  console.log(`✗ ${err?.message || err}`)
  exitCode = 1
} finally {
  await app.close().catch(() => undefined)
  process.exit(exitCode)
}
