// R16 真实任务矩阵走查：「入口 × 媒体」——每格都像真人一样点，记录成功 / 拒绝文案 / 耗时 / 有没有进度。
//
// 为什么是矩阵而不是单条：用户原话「这地方要通用支持，不能只支持一部分」。一条走查只能证明
// 一个入口收一种媒体；要证「每个入口都收每种媒体」必须把格子铺开跑一遍（记录并继续，不第一格红就停）。
//
// 驱动方式全部是界面动作：文件选择器用 setInputFiles（等价真人在 OS 对话框里选文件，Electron
// webUtils.getPathForFile 拿得到真实路径）；粘贴走主进程 clipboard 写 file-url + 真实 Cmd/Ctrl+V；
// 拖入走真实 DragEvent。不直接调 assets.copyFiles / importFile 这类 IPC。
// 素材怎么来（本机跑之前先备好；缺了会逐格报 fixture-missing 并 exit 1，不会假绿）：
//   SRC=<一段真实 4K HEVC 视频>
//   M=~/Desktop/nomi-media-fixtures; mkdir -p $M
//   ffmpeg -ss 12 -i "$SRC" -frames:v 1 $M/4k-frame.png
//   ffmpeg -i $M/4k-frame.png -vf scale=640:-1 $M/small.png
//   python3 -c "from PIL import Image; Image.open('$M/small.png').save('$M/small.webp','WEBP')"
//   ffmpeg -ss 12 -t 2 -i "$SRC" -vf "fps=8,scale=320:-1" $M/small.gif
//   ffmpeg -ss 12 -t 8 -i "$SRC" -vf scale=854:-2 -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -an $M/small-h264.mp4
//   ffmpeg -ss 12 -t 10 -i "$SRC" -c copy $M/hevc-10s.mov
//   ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -c:a libmp3lame $M/tone.mp3
//   ffmpeg -f lavfi -i "sine=frequency=660:duration=5" $M/tone.wav
// NOMI_HUGE_VIDEO 指向一段**真实的大视频**（用户那段是 1.38GB / 3840×2160 / 10-bit HEVC / 527s）；
// 它是整条矩阵里最有信息量的一格——上限、转码、体感全靠它，别拿合成小样替。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { DEFAULT_TIMEOUT_MS, clickOrFail, expectVisible } from './_assert.mjs'

const FIXTURE_DIR = process.env.NOMI_MEDIA_FIXTURE_DIR || '/Users/aoqimin/Desktop/nomi-media-fixtures'
const HUGE_VIDEO = process.env.NOMI_HUGE_VIDEO || '/Users/aoqimin/Desktop/视频/9月12日(1)/9月12日(1).mov'
// 默认落仓库根 scratchpad/（已 .gitignore，只住 worktree）。要留档的那一轮用
// NOMI_MATRIX_OUT=docs/evidence/<日期>-<主题> 指过去，别把中间产物提进树。
const OUT_DIR = process.env.NOMI_MATRIX_OUT || path.join(process.cwd(), 'scratchpad/media-import')
const SHOT_DIR = path.join(process.env.NOMI_MATRIX_OUT || path.join(process.cwd(), 'scratchpad/media-import'), 'shots', process.env.NOMI_MATRIX_TAG || 'run')
const CELL_TIMEOUT_MS = Number(process.env.NOMI_MATRIX_CELL_TIMEOUT_MS || 15000)
// 1.38GB 那格要给整段转码留时间才能量到「用户等多久」；其余格子 25s 足够。
const HUGE_CELL_TIMEOUT_MS = Number(process.env.NOMI_MATRIX_HUGE_TIMEOUT_MS || 180000)

const MEDIA = [
  { id: 'png-small', label: '小 PNG (1.0MB)', file: path.join(FIXTURE_DIR, 'small.png') },
  { id: 'png-4k', label: '4K PNG (24.9MB)', file: path.join(FIXTURE_DIR, '4k-frame.png') },
  { id: 'webp', label: 'WebP (21KB)', file: path.join(FIXTURE_DIR, 'small.webp') },
  { id: 'gif', label: 'GIF (151KB)', file: path.join(FIXTURE_DIR, 'small.gif') },
  { id: 'mp4-small', label: '小 MP4 H.264 (285KB)', file: path.join(FIXTURE_DIR, 'small-h264.mp4') },
  { id: 'mov-hevc-10s', label: '10s HEVC 10bit MOV (29MB)', file: path.join(FIXTURE_DIR, 'hevc-10s.mov') },
  { id: 'mov-hevc-huge', label: '用户 1.38GB 4K HEVC MOV (527s)', file: HUGE_VIDEO, readOnly: true },
  { id: 'mp3', label: 'MP3 (40KB)', file: path.join(FIXTURE_DIR, 'tone.mp3') },
  { id: 'wav', label: 'WAV (441KB)', file: path.join(FIXTURE_DIR, 'tone.wav') },
]

fs.mkdirSync(SHOT_DIR, { recursive: true })
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-media-matrix-'))

/**
 * **每个入口一个全新项目 + 全新实例**。
 *
 * 为什么不共用一个项目：素材落盘是内容寻址的（同样的字节 = 同一个文件）。上一行入口已经把这批
 * 素材导进来之后，下一行永远看不到「新文件」；而把 assets/ 目录删掉来绕开它更糟——落盘侧仍然
 * 认得那份内容，节点拿回一个指向已删文件的记录，界面显示「加载失败／重试」，看起来和真的
 * 导入失败一模一样（这一条是实测撞出来的：单独跑同一格完全正常）。
 * 换新项目是唯一不会污染被测对象的隔离方式。
 */
function makeProject(entryId) {
  const projectsDir = path.join(base, entryId, 'projects')
  const projectId = `matrix-${entryId}`
  const projectRoot = path.join(projectsDir, `p-${projectId}`)
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
  const project = {
    id: projectId, name: PROJECT_NAME, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
    lastKnownRootPath: projectRoot, workbenchDocument: null, timeline: null, generationCanvas,
    payload: { workbenchDocument: null, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false },
  }
  for (const f of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
    fs.writeFileSync(f, JSON.stringify(project, null, 2))
  }
  return {
    projectsDir,
    projectRoot,
    userDataDir: path.join(base, entryId, 'user-data'),
    settingsDir: path.join(base, entryId, 'settings'),
  }
}

const PROJECT_NAME = '媒体导入矩阵'
let projectRoot = ''

function assetFiles() {
  const root = path.join(projectRoot, 'assets')
  if (!fs.existsSync(root)) return []
  const out = []
  const visit = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) visit(full)
      else if (e.isFile() && !e.name.endsWith('.json') && !e.name.endsWith('.playable')) out.push(full)
    }
  }
  visit(root)
  return out
}

/**
 * 画布工具条那个隐藏 file input 的精确身份。**别只按 accept 选**：素材库的上传 input
 * 现在 accept 里也有 video/*（它本来就该收视频），只按 accept 选会选中它，
 * 于是「画布导入」那一行量到的其实是素材库——一整行数据作废。
 * 画布那个是 aria-hidden + tabindex=-1，素材库那个有 aria-label 且 multiple。
 */
const CANVAS_FILE_INPUT = (win) =>
  win.locator('input[type="file"][aria-hidden="true"][tabindex="-1"]').first()

const rows = []
const failures = []
let app

/**
 * 这趟走查要证明三件事，每件都是一条失败路径：
 *  F1 素材库面板真的打开了（打不开，后面所有格子都是假数据）
 *  F2 每一格应用都给了答复——不许「什么都没发生、也没说一个字」（silent-drop / timeout）
 *  F3 被拒的格子必须给出**能行动的理由**：要么带数字（多大 / 还剩多少 / 上限多少），
 *     要么说清这个面为什么放不下它。只说「不支持」「过大」的一律算没给。
 * NOMI_MATRIX_EXPECT_UNIVERSAL=1 时再加一条 F4：每个入口都必须收下它声明收的每一种媒体。
 */
const EXPECT_UNIVERSAL = process.env.NOMI_MATRIX_EXPECT_UNIVERSAL === '1'
const ACTIONABLE = /\d+(\.\d+)?\s*(B|KB|MB|GB)|放不下|装不下|没有落点|纹理|上下文/

/** 素材库面板自己的反馈行——「这一格有没有重新渲染过」只看它，别掺页面上别的 role=status。 */
async function readPanelMessages(win) {
  return (await win.locator('[data-asset-library-feedback]').allTextContents().catch(() => []))
    .map((t) => t.trim()).filter(Boolean)
}

/** 等落盘安静：连续 1.5s 没有新文件出现才算这一格真的结束。 */
async function settleAssets(win, budgetMs) {
  const deadline = Date.now() + budgetMs
  let known = new Set(assetFiles())
  let quietSince = Date.now()
  const floor = Date.now() + 4000
  while (Date.now() < deadline) {
    await win.waitForTimeout(150)
    const now = assetFiles()
    if (now.length !== known.size) {
      known = new Set(now)
      quietSince = Date.now()
      continue
    }
    if (Date.now() >= floor && Date.now() - quietSince >= 1500) return
  }
}

async function readMessages(win) {
  const panel = await readPanelMessages(win)
  const toast = await win.locator('[data-notification], [role="alert"], [role="status"]').allTextContents().catch(() => [])
  return [...panel, ...toast.map((t) => t.trim()).filter(Boolean)]
}

/** 每格：先记基线 → 做界面动作 → 轮询「落盘变化 或 界面出反馈」直到超时。记录并继续。 */
async function runCell(win, entry, medium, act, previousRow) {
  const before = new Set(assetFiles())
  const beforeNodes = await entry.countNodes?.(win) ?? 0
  // 面板反馈是累积渲染的（上一格的「已跳过…」还挂在那）。只认这一格**新出现**的句子，
  // 否则上一格的拒绝会被记成这一格的拒绝（假红）。
  // 面板反馈是累积 + 去重渲染的：上一格的「已跳过…」还挂着，这一格出一模一样的句子时，
  // 只能靠「面板先被 present('') 清空、再重填」这个窗口把两格分开。窗口是几百毫秒量级，
  // 所以下面按 60ms 轮询。**不要**用 DOM 摘除来制造这个窗口：摘掉 React 管着的节点会把
  // 素材库整块打进错误边界（「素材库加载失败」），度量手段反过来毁掉被测对象。
  const beforeMessages = new Set(await readMessages(win))
  const beforePanel = new Set(await readPanelMessages(win))
  const started = Date.now()
  const row = {
    entry: entry.label, media: medium.label, mediaId: medium.id, entryId: entry.id,
    outcome: 'unknown', message: '', ms: 0, progress: 'none', landed: '',
  }
  try {
    await act()
  } catch (error) {
    row.outcome = 'action-error'
    row.message = String(error?.message || error).slice(0, 200)
    row.ms = Date.now() - started
    rows.push(row)
    return row
  }
  const deadline = started + (medium.readOnly ? HUGE_CELL_TIMEOUT_MS : CELL_TIMEOUT_MS)
  let sawProgress = false
  // 面板反馈会把重复句子去重（present 里的 Set），所以「和上一格一模一样的拒绝」不会变成新句子。
  // 每个入口动作开头都会先 present('') 清空——先等这一次清空发生，之后出现的句子才算这一格的。
  let panelCleared = beforePanel.size === 0
  while (Date.now() < deadline) {
    // 有没有进度反馈：面板/节点上出现「导入中 / 处理中 / %」之类的可见状态。
    if (!sawProgress) {
      const progressCount = await win.locator('[data-asset-import-progress], [data-node-upload-progress], text=/导入中|处理中|转码/').count().catch(() => 0)
      if (progressCount > 0) sawProgress = true
    }
    const now = assetFiles().filter((f) => !before.has(f))
    if (now.length > 0) {
      row.outcome = 'ok'
      row.landed = now.map((f) => `${path.basename(f)} (${(fs.statSync(f).size / 1048576).toFixed(1)}MB)`).join(', ')
      break
    }
    const nodes = await entry.countNodes?.(win) ?? 0
    const current = await readMessages(win)
    if (!panelCleared) {
      const panelNow = await readPanelMessages(win)
      if (panelNow.length !== beforePanel.size || panelNow.some((t) => !beforePanel.has(t))) panelCleared = true
    }
    const messages = !panelCleared ? [] : current
      .filter((t) => /跳过|失败|过大|不支持|没有检测到|忽略|放不下|装不下|超过|不是 Nomi/.test(t))
    if (messages.length > 0) {
      row.outcome = 'rejected'
      row.message = messages.join(' / ').slice(0, 240)
      break
    }
    if (nodes > beforeNodes) sawProgress = true // 画布上的「正在导入」就是那个新节点
    await win.waitForTimeout(60)
  }
  if (row.outcome === 'unknown') {
    // 这一格什么都没落盘。面板上挂着一句拒绝——它可能就是上一格那句（面板会去重，
    // 一模一样的句子不会重新出现），所以分不出「重新报了一次」还是「还是上次那句」。
    // 但「没落盘」本身已经是结论：这一格被拒了。据此记 rejected，并标明文案可能是沿用的。
    const lingering = (await readPanelMessages(win)).filter((t) => /跳过|失败|过大|不支持|放不下|装不下/.test(t))
    // 只有当**同一行的上一格**也是因为同一句话被拒时，这句话才可能是这一格重发的。
    // 上一格若是成功，那这句就是更早那一行留下的陈迹，不能算作这一格的证据——
    // 那种情况是「什么都没落盘、也没给任何反馈」，本身就是一条要报出来的发现（静默丢弃）。
    const repeatable = previousRow && previousRow.outcome === 'rejected'
      && lingering.some((t) => previousRow.message.startsWith(t.slice(0, 12)))
    if (lingering.length > 0 && repeatable) {
      row.outcome = 'rejected'
      row.message = `${lingering.join(' / ').slice(0, 200)}（文案与上一格相同，面板去重）`
    } else {
      row.outcome = lingering.length > 0 ? 'silent-drop' : 'timeout'
      if (row.outcome === 'silent-drop') row.message = '什么都没落盘，也没给这一格任何反馈（面板上只有更早留下的陈迹）'
    }
  }
  row.ms = Date.now() - started
  row.progress = sawProgress ? 'yes' : 'none'
  rows.push(row)
  console.log(`CELL ${row.entryId} × ${row.mediaId} → ${row.outcome} ${row.ms}ms ${row.message || row.landed}`)
  return row
}

const ENTRIES = [
  {
    id: 'library-upload', label: '素材库「上传」按钮',
    act: (m, ctx) => ctx.uploadInput.setInputFiles(m.file),
  },
  {
    id: 'library-paste', label: '素材库 Finder 粘贴 (Cmd+V)',
    act: async (m, ctx) => {
      const { win, app, panel } = ctx
      await app.evaluate(({ clipboard }, url) => { clipboard.clear(); clipboard.writeText(url) }, pathToFileURL(m.file).href)
      await panel.click({ position: { x: 10, y: 10 } }).catch(() => {})
      await panel.focus().catch(() => {})
      await win.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
      await win.waitForTimeout(250)
      // Playwright 无桌面剪贴板后端时只产生 keydown；把同一个 DOM paste 事件打在面板根上，
      // 仍然走面板真实 onPaste → clipboard IPC → 落盘链路（不直接调 IPC）。
      await win.evaluate(() => {
        document.querySelector('section[aria-label="素材库"] > div[tabindex="0"]')
          ?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }))
      })
    },
  },
  {
    id: 'library-drop', label: '素材库 Finder 拖入',
    act: async (m, ctx) => {
      await ctx.win.evaluate(({ name, filePath, type }) => {
        const file = new File([new Uint8Array([0])], name, { type })
        Object.defineProperty(file, 'path', { value: filePath })
        const dt = new DataTransfer(); dt.items.add(file)
        document.querySelector('section[aria-label="素材库"] > div[tabindex="0"]')
          ?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      }, { name: path.basename(m.file), filePath: m.file, type: '' })
    },
  },
  {
    id: 'canvas-import', label: '画布左缘「导入」（同拖入画布的唯一一条路）',
    // 节点一拖就出现，但那只是「开始了」；这一格真正的结果是素材有没有落盘。
    countNodes: (w) => w.locator('.react-flow__node').count().catch(() => 0),
    open: async ({ win }) => {
      // 画布本来就在素材库面板后面；把面板收起来，节点才看得见（截图要人眼判断）。
      const close = win.locator('section[aria-label="素材库"] button[aria-label*="关闭"]').first()
      if (await close.count().catch(() => 0)) await close.click({ timeout: 3000 }).catch(() => {})
      await CANVAS_FILE_INPUT(win).waitFor({ state: 'attached', timeout: DEFAULT_TIMEOUT_MS })
      await win.waitForTimeout(500)
    },
    act: async (m, ctx) => {
      await CANVAS_FILE_INPUT(ctx.win).setInputFiles(m.file)
    },
  },
]

async function openLibrary(win) {
  const card = win.getByText(PROJECT_NAME, { exact: false }).first()
  await clickOrFail(card, `项目卡「${PROJECT_NAME}」`)
  const cont = win.getByText('继续创作', { exact: false }).first()
  const libBtn = win.getByRole('button', { name: '素材库', exact: true }).first()
  const section = win.locator('section[aria-label="素材库"]')
  const step = await Promise.any([
    cont.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS }).then(() => 'continue'),
    section.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS }).then(() => 'library'),
  ])
  if (step === 'continue') {
    await clickOrFail(cont, '继续创作')
    await Promise.any([
      section.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS }).then(() => 'library'),
      libBtn.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS }).then(() => 'button'),
    ])
  }
  if (!(await section.isVisible())) await clickOrFail(libBtn, '素材库')
  // F1：面板没打开，后面每一格都是假数据，必须当场红。
  await expectVisible(section, '素材库面板应该打开——它是本矩阵前三行的被测面')
  return section
}

try {
  for (const entry of ENTRIES) {
    const dirs = makeProject(entry.id)
    projectRoot = dirs.projectRoot
    ;({ app } = await launchNomiApp({
      name: `media-import-matrix-${entry.id}`,
      userDataDir: dirs.userDataDir,
      settingsDir: dirs.settingsDir,
      projectsDir: dirs.projectsDir,
      env: { NOMI_E2E_SMOKE: '1' },
    }))
    const win = await app.firstWindow()
    await win.evaluate(() => {
      for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
        window.localStorage.setItem(key, 'seen')
      }
    })
    await win.reload()
    await win.waitForTimeout(1200)
    await openLibrary(win)
    const panel = win.locator('section[aria-label="素材库"] > div[tabindex="0"]').first()
    const uploadInput = win.locator('section[aria-label="素材库"] input[type="file"]').first()
    const ctx = { win, app, panel, uploadInput }
    if (entry.open) await entry.open(ctx)
    for (const medium of MEDIA) {
      if (!fs.existsSync(medium.file)) {
        rows.push({ entry: entry.label, media: medium.label, mediaId: medium.id, entryId: entry.id, outcome: 'fixture-missing', message: medium.file, ms: 0, progress: 'none', landed: '' })
        continue
      }
      await runCell(win, entry, medium, () => entry.act(medium, ctx), rows.filter((r) => r.entryId === entry.id).at(-1))
      await settleAssets(win, medium.readOnly ? HUGE_CELL_TIMEOUT_MS : CELL_TIMEOUT_MS)
    }
    await win.screenshot({ path: path.join(SHOT_DIR, `matrix-${entry.id}.png`) }).catch(() => {})
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 4000))]).catch(() => {})
    app = undefined
  }
} finally {
  for (const row of rows) {
    // F2：应用必须给答复。什么都没落盘、也没给这一格任何反馈 = 静默丢弃，用户对着界面发呆。
    if (row.outcome === 'silent-drop' || row.outcome === 'timeout') {
      failures.push(`${row.entryId} × ${row.mediaId}：${row.outcome}——${row.message || '应用一个字都没说'}`)
      continue
    }
    // F3：拒绝要给能行动的理由。
    if (row.outcome === 'rejected' && !ACTIONABLE.test(row.message)) {
      failures.push(`${row.entryId} × ${row.mediaId}：拒绝了却没给能行动的理由 →「${row.message}」`)
    }
    if (row.outcome === 'action-error' || row.outcome === 'fixture-missing') {
      failures.push(`${row.entryId} × ${row.mediaId}：${row.outcome} ${row.message}`)
    }
  }
  // F4：修完之后，每个入口都必须收下它声明收的每一种媒体（用户原话：不能只支持一部分）。
  if (EXPECT_UNIVERSAL) {
    for (const row of rows) {
      const audioOnCanvas = row.entryId === 'canvas-import' && (row.mediaId === 'mp3' || row.mediaId === 'wav')
      if (row.outcome !== 'ok' && !audioOnCanvas) {
        failures.push(`${row.entryId} × ${row.mediaId}：这个入口声明收这种媒体，却没收下 →「${row.message}」`)
      }
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, `matrix-${process.env.NOMI_MATRIX_TAG || 'run'}.json`), JSON.stringify(rows, null, 2))
  console.log(`MATRIX ROWS: ${rows.length}`)
  console.log(rows.map((r) => `${r.entryId}|${r.mediaId}|${r.outcome}|${r.ms}ms|${r.progress}|${r.message || r.landed}`).join('\n'))
  if (app) await Promise.race([app.close(), new Promise((r) => setTimeout(r, 4000))]).catch(() => {})
  if (failures.length > 0) {
    console.error(`\n✖ 媒体导入矩阵有 ${failures.length} 格不合格：`)
    for (const line of failures) console.error(`  - ${line}`)
    process.exitCode = 1
  } else {
    console.log('✅ 媒体导入矩阵：每一格都成功，或给出了带数字/带理由的明确拒绝。')
  }
}
