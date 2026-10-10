// T-ED-06 终态保证 · 真机冷重启走查（R13/R16，零成本：不调任何模型、不花一分钱）。
//
// 复的是 docs/audit/2026-09-17-post-804-walkthrough.md §6.5 那一屏：
// 「拆解跑到一半把 app 关掉再打开：分镜表节点**永久停在「本地找切点 / 0 镜」**——
//   空白一片、不报错、不续跑、不提示可重试。看起来和「正在跑」一模一样，实际已经死了。」
//
// 怎么造那个现场，以及为什么这样造：
//   真的「跑到一半」需要一次**付费**拆解（切点之后就是逐镜读图），而要复的这个 bug
//   根本不在引擎里——它在**重开项目那条读路径**上：快照收敛把 running 收成终态，
//   紧接着的事件尾巴重放又把 running 原样写了回去。所以这条走查用 store seam 造出
//   「磁盘上留着一张 running 的表」这个**前置现场**（等价于上次退出时正跑到一半），
//   然后**真的关掉 app、真的再启一次**，验的是真实的 hydrate：真 project.json、
//   真事件日志、真 restoreSnapshot + applyEventTail、真渲染。
//   —— seam 只用来摆现场，断言全落在重启之后的真实界面上。
//
// 三条断言，缺一条这个 bug 就还在：
//   ① 重启后那一格**不再是「本地找切点」**（进行中那句话不许再出现）
//   ② 有**一句用户看得见的话**说清发生了什么（空表 + 没有话 = 和「还没拆过」长得一样）
//   ③ 有**能点的找回入口**（「重新拆解」），且点得动——走查 §6.5 的原话是
//      「行级重试在代码里是有的，但这个卡死态根本走不到那一层」
//
// 另加 R15 双轨：中断这句话在 English 下也要是英文（新文案两语同批加的）。
//
// 用法：pnpm run build && node tests/ux/deconstruction-interrupted-recovery.walk.mjs
// 产出：tests/ux/shots/deconstruction-interrupted-recovery/*.png
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { newProjectEntry } from './_shell.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const root = path.join(repoRoot, '.tmp', 'deconstruction-interrupted-recovery')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const userDataDir = path.join(root, 'user')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/deconstruction-interrupted-recovery')
fs.rmSync(root, { recursive: true, force: true })
for (const dir of [settingsDir, projectsDir, userDataDir, shotsDir]) fs.mkdirSync(dir, { recursive: true })

const FIXTURE = path.join(repoRoot, 'tests/ux/fixtures/fixture-video.mp4')
if (!fs.existsSync(FIXTURE)) {
  console.log(`SKIP: 找不到 fixture 视频 ${FIXTURE}`)
  process.exit(0)
}

// 走查里要认的两句用户可见文案（唯一真相源是 src/i18n/locales/shotTable.ts，这里只抄断言用的片段）。
const RUNNING_PHRASE = '本地找切点'
const INTERRUPTED_PHRASE = '这次拆解被中断了'
const INTERRUPTED_PHRASE_EN = 'Interrupted (the app closed'
const RESTART_LABEL = '重新拆解'

const failures = []
const check = (ok, label) => { console.log(`  ${ok ? '✓' : '✗'} ${label}`); if (!ok) failures.push(label) }

async function openBlankProjectCanvas(win) {
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  for (let i = 0; i < 4; i += 1) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(160) }
  await clickOrFail(newProjectEntry(win), '新建空白项目', { noWaitAfter: true })
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(win.locator('[data-mode="generation"]'), '生成 tab')
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: DEFAULT_TIMEOUT_MS })
}

async function reopenProjectCanvas(win) {
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  for (let i = 0; i < 4; i += 1) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(160) }
  // 隔离 profile 里只有刚才那一个项目；按语义按钮「继续创作」打开它（不按坐标、不按第 N 张卡）。
  await clickOrFail(win.getByRole('button', { name: '继续创作', exact: true }).first(), '继续创作（打开上次那个项目）', { noWaitAfter: true })
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(win.locator('[data-mode="generation"]'), '生成 tab')
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: DEFAULT_TIMEOUT_MS })
}

let { app, win } = await launchNomiApp({ name: 'deconstruction-interrupted-recovery', userDataDir, settingsDir, projectsDir, settleMs: 0 })
const snap = (name) => screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })

try {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1680, height: 1020 }))
  await openBlankProjectCanvas(win)

  // 素材走真 IPC 导入（和用户拖一条视频进来同一条路），拿到真的 nomi-local:// 地址。
  const bytes = fs.readFileSync(FIXTURE)
  const seeded = await win.evaluate(async ({ b64, phraseTitle }) => {
    const activeId = /projectId=([^&]+)/.exec(location.href)?.[1]
    if (!activeId) return { error: 'no active projectId in url' }
    const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const saved = await window.nomiDesktop.assets.importFile({
      projectId: activeId, bytes: binary.buffer, contentType: 'video/mp4', fileName: 'reference.mp4', kind: 'upload',
    })
    if (!saved.ok) return { error: saved.failure.reason }
    const url = saved.asset.data?.url || ''
    if (!url) return { error: 'asset import failed' }
    const store = window.__nomiCanvasStore.getState()
    const video = store.addNode({ kind: 'video', title: '参考片', position: { x: 120, y: 160 } })
    store.updateNode(video.id, { result: { id: `seed-${Date.now()}`, type: 'video', url, createdAt: Date.now() } })
    // 现场：一张**正跑到「本地找切点」**的分镜表（= 上次退出那一刻磁盘上的样子）。
    const table = store.addNode({
      kind: 'shot_table', title: '参考片', position: { x: 620, y: 160 },
      meta: { shotTable: {
        schemaVersion: 1,
        source: { kind: 'deconstruction', sourceNodeId: video.id, title: '参考片', status: 'running', phase: 0 },
        columnSetId: 'facts',
        columns: ['shotSize', 'motion', 'visual', 'dialogue', 'onScreenText', 'mood']
          .map((columnId, order) => ({ columnId, kind: 'builtin', labelKey: columnId, order, visible: true })),
        rows: [],
        view: { selectedRowIds: [], density: 'auto' }, revision: 2, updatedAt: new Date().toISOString(),
      } },
    })
    store.connectNodes(video.id, table.id)
    return { videoId: video.id, tableId: table.id }
  }, { b64: bytes.toString('base64') })
  check(Boolean(seeded.tableId), `摆好现场：一张停在「${RUNNING_PHRASE}」的表（${seeded.error || seeded.tableId}）`)
  if (!seeded.tableId) { await snap('00-seed-FAIL'); throw new Error(`seed 失败：${JSON.stringify(seeded)}`) }

  const tableNode = win.locator('[data-testid="shot-table-node"]').first()
  await proveProbe(tableNode, '分镜表节点在画布上')
  // 退出前先证「进行中那句话此刻确实在」——没有这个证明，重启后的 expectAbsent 就是一次瞎探针。
  const runningPhrase = tableNode.getByText(RUNNING_PHRASE, { exact: false })
  const runningProof = await proveProbe(runningPhrase, `退出前它确实印着「${RUNNING_PHRASE}」`)
  await snap('01-before-quit-running')

  // 让画布落盘（防抖写），再真的关掉 app——这就是用户那一下「拆到一半把 app 关了」。
  await win.waitForTimeout(2200)
  try { await app.close() } catch {}

  // ── 冷重启：真 hydrate（真 project.json + 真事件尾巴重放）。──
  ;({ app, win } = await launchNomiApp({ name: 'deconstruction-interrupted-recovery-restart', userDataDir, settingsDir, projectsDir, settleMs: 0 }))
  const restartedWindow = await app.browserWindow(win)
  await restartedWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1680, height: 1020 }))
  await reopenProjectCanvas(win)

  // 收起助手面板 + 适应视图：否则表节点被右侧面板压掉半张，截图看不出那句话完没完整
  // （节点被压这件事本身是 T-DS-14，不在本刀范围，但截图必须是能用人眼判的）。
  await clickOrFail(win.getByRole('button', { name: '收起面板', exact: true }), '收起助手面板')
  await clickOrFail(win.getByRole('button', { name: '适应视图', exact: true }), '适应全部节点')
  // 适应视图会缩到看不清字；截图要的是人眼能读的那一档，所以回到 100%。
  await clickOrFail(win.getByRole('button', { name: '重置视图', exact: true }), '重置为 100%')
  await expect(win.getByRole('slider', { name: '缩放比例', exact: true })).toHaveValue('100')

  const restarted = win.locator('[data-testid="shot-table-node"]').first()
  await proveProbe(restarted, '重启后分镜表节点还在（证据没丢）')

  // ① 进行中那句话不许再出现。
  await expectAbsent(restarted.getByText(RUNNING_PHRASE, { exact: false }), {
    provenBy: runningProof,
    message: `重启后它还印着「${RUNNING_PHRASE}」——这正是 §6.5 那个永久卡死态`,
  })
  check(true, `① 重启后不再印「${RUNNING_PHRASE}」`)

  // ② 有一句用户看得见的话。
  const notice = restarted.locator('[data-testid="shot-table-interrupted-notice"]')
  await expectVisible(notice, '重启后没有任何一句话解释发生了什么（空表和「还没拆过」长得一样）')
  await expect(notice).toContainText(INTERRUPTED_PHRASE)
  check(true, '② 中断说明可见且说人话')

  // ③ 有能点的找回入口。
  const restart = restarted.locator('[data-testid="shot-table-restart-deconstruction"]')
  await expectVisible(restart, '重启后没有「重新拆解」入口——走查原话：这个卡死态根本走不到重试那一层')
  await expect(restart).toBeEnabled()
  await expect(restart).toContainText(RESTART_LABEL)
  check(true, `③ 「${RESTART_LABEL}」可见且可点`)
  await snap('02-after-restart-interrupted')

  // R15 双轨：这两句是本批新加的文案，English 下必须是英文。
  await clickOrFail(win.getByRole('button', { name: '设置', exact: true }), '设置')
  await clickOrFail(win.locator('[data-settings-tab-id="general"]'), '通用')
  await clickOrFail(win.locator('[data-settings-locale="en"]'), '语言分段控件「English」')
  await expectVisible(win.locator('[data-settings-locale="en"][aria-pressed="true"]'), '界面已切到 English')
  await win.keyboard.press('Escape')
  await expect(win.locator('[data-settings-dialog]')).toBeHidden()
  const enNotice = win.locator('[data-testid="shot-table-interrupted-notice"]').first()
  await expectVisible(enNotice, 'English 下中断说明不见了')
  await expect(enNotice).toContainText(INTERRUPTED_PHRASE_EN)
  await expect(win.locator('[data-testid="shot-table-restart-deconstruction"]').first()).not.toContainText(RESTART_LABEL)
  check(true, 'R15：English 下中断说明与找回入口都是英文')
  await snap('03-after-restart-interrupted-en')
  // 拍完切回中文，不把用户的界面留在英文。
  await clickOrFail(win.getByRole('button', { name: 'Settings', exact: true }), 'Settings')
  await clickOrFail(win.locator('[data-settings-tab-id="general"]'), 'General')
  await clickOrFail(win.locator('[data-settings-locale="zh-CN"]'), '切回中文')
  await win.keyboard.press('Escape')
  await expect(win.locator('[data-settings-dialog]')).toBeHidden()
} finally {
  try { await app.close() } catch {}
}

console.log(`\n截图：${shotsDir}`)
if (failures.length) {
  console.error(`\n✗ ${failures.length} 条没过：\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\n✓ T-ED-06 终态保证：中断后落「中断，可重试」，有话说、点得动。')
