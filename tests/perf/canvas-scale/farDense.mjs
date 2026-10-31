// 远看密集画布（设计卡 docs/plan/2026-10-31-canvas-detail-admission.md ★7）：用户反馈现场的形状——
// 一组参考（10 张）连出 240 条参考线到 30 镜的分镜组，旁边另一组 20 张图；缩到 20% 平移、滚轮缩放。
//
// 量两样，两样都是硬数：
//   · 帧间隔 / 长任务：和其它手势同一个帧探针（canvas-scale-bench 的 startWindow / stopWindow）；
//   · 缺块率：窗口这一刻真正合成出来的那一帧（主进程 webContents.capturePage，不是页内截图）里，
//     每张已经解码好的图是不是真的画出来了、组的底色有没有画。逐张图把框内缩成 8×8 均色格，和这张预览自己的 8×8 格比：
//     离预期颜色远、又更像「什么都没画」的颜色（画布底、组底、卡片占位底）的格子算缺；一张卡一半以上的格子缺 = 这张卡空了。
//     预期颜色本身就接近空白色的格子不计（判不出来）。每个样本先做阳性对照：人为藏起一张已解码的图，量具必须报出这一张，
//     报不出来这个样本的缺块率作废（不交数 → 统一跑法判 no-data，红）。
//
// 素材：仓库里登记过的真实镜头（tests/ux/real-media-fixtures.json 的 video-canvas-follow-hand-1080p15）抽 60 帧，
// 原图 1920×1080，预览按生产规则（长边 1024、-q:v 4，同 electron/assets/assetPreview.ts）。不用合成色块：
// 60 张不同的图才有真实的解码缓存压力。第一次跑要抽帧（约十几秒），之后走系统临时目录里的缓存。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createCanvasPerformanceFixture } from '../../ux/fixtures/canvas-performance-fixture.mjs'
import { canvasSetZoomPercent } from '../../ux/_shell.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SOURCE_VIDEO = path.join(repoRoot, 'tests/ux/fixtures/canvas-follow-hand-1080p15.mp4')
const TEMPLATE_PROJECT = path.join(repoRoot, 'tests/ux/fixtures/perf-heavy.project.json')
const CARD = Object.freeze({ width: 320, height: 180 })

/** 本模块提供的规模（canvas-scale-bench 的 --scales 可选值的一部分）。 */
export const FAR_DENSE_SCALES = Object.freeze({
  // 反馈视频那一屏：参考 10 + 分镜 30 + 图片 20 = 60 张图（低于旧判据的 80 个节点），每镜连 8 条参考 = 240 条线。
  D60: { refs: 10, shots: 30, images: 20, refsPerShot: 8 },
})
/** 本模块提供的场景名（点名才跑：要 D60 的夹具才有预期格）。 */
export const FAR_DENSE_SCENARIOS = Object.freeze(['far-dense-pan'])
/**
 * 带进样本的数。主数 blankCardPct（各缩放档停稳后缺块率里最差的那档）；结构数（farCardDom / layers / decodedOverScreen / canvasVideos）
 * 有硬预算（见 FAR_DENSE_STRUCTURE_BUDGETS）；tileOomLines 是 Chromium 自己报的「瓦片内存不够、有内容没画」次数；其余只看。
 */
export const FAR_DENSE_SAMPLE_KEYS = Object.freeze([
  'blankCardPct', 'blankPct20', 'blankPct35', 'blankPct55', 'blankCardPctMoving', 'groupMissingPct', 'scoredCards', 'lightweightCards', 'oracleControl',
  'tileOomLines', 'farCardDom', 'cardDom55', 'canvasVideos', 'decodedOverScreen', 'layers', 'layers55', 'frameP95At20', 'frameP95At35', 'frameP95At55',
])

/**
 * 量哪几档缩放：20%（反馈视频那一屏）、35%（Chromium 在 25% 以上把 will-change 层的栅格倍率钉在设备像素比，
 * 而我们的细节线在 40%——35% 是轻量卡这一侧屏上卡最多、栅格最贵的一档）、55%（细节线之上：整卡的一档）。
 * 细节线刚过去的 41%（同屏整卡最多）不在这里，由 canvas-scale-bench 的 L 档 --gesture-zoom 0.41 量。
 */
export const FAR_DENSE_ZOOMS = Object.freeze([20, 35, 55])
/** 细节线（同 src/workbench/generationCanvas/components/canvasNodeLevelOfDetail.ts 的 LIGHTWEIGHT_NODE_ZOOM_THRESHOLD）。 */
const DETAIL_LINE_PERCENT = 40

/**
 * 结构预算：不依赖显卡、在没有 GPU 的 CI 上也判得稳的硬数。任一样本超了，canvas-scale-bench 非 0 退出（统一跑法判 no-data，红），
 * 打印是哪一条。数怎么来的见设计卡 docs/plan/2026-10-31-canvas-detail-admission.md「量到了什么」（512MB + 设备像素比 1.25）。
 *   · farCardDom：缩远（< 细节线）时，屏上每张卡的 DOM 元素数（屏上各卡的中位数，各远看档里最差的一档）。轻量卡 18、整卡 26——
 *     判据退回「按节点数切」时 60 张的画布远看画整卡，这一条红；
 *   · layers：缩远时的合成层数（CDP LayerTree）。视口不常驻合成层时 8；`will-change: transform` 加回来时 75–106
 *     （连线 / 组框 / 卡各成一层，瓦片预算装不下就整块不画）——这一条红；
 *   · decodedOverScreen：挂着的图解码后的像素总和 ÷ 屏幕物理像素（各档最差）。画布预览档 17.7；换成原图是 62；
 *   · canvasVideos：画布里同时挂着的 <video> 数。
 */
export const FAR_DENSE_STRUCTURE_BUDGETS = Object.freeze({ farCardDom: 20, layers: 20, decodedOverScreen: 20, canvasVideos: 1 })

/** 一个样本超了哪几条结构预算（空 = 都在预算内）。 */
export function farDenseStructureViolations(sample) {
  const over = []
  for (const [key, budget] of Object.entries(FAR_DENSE_STRUCTURE_BUDGETS)) {
    const value = sample?.[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) over.push(`${key} 没量到`)
    else if (value > budget) over.push(`${key} ${value} > 预算 ${budget}`)
  }
  return over
}

/** Chromium 的瓦片超限日志（cc/tiles/tile_manager.cc：需要现在画的瓦片放不下时每次都打一行；要 --enable-logging=stderr）。 */
const TILE_OOM_LINE = /tile memory limits exceeded/
const tileLogs = new WeakMap()
export function tileOomCounter(app) {
  let counter = tileLogs.get(app)
  if (counter) return counter
  counter = { at: [] }
  let tail = ''
  app.process?.()?.stderr?.on('data', (chunk) => {
    const lines = (tail + String(chunk)).split('\n')
    tail = lines.pop() ?? ''
    for (const line of lines) if (TILE_OOM_LINE.test(line)) counter.at.push(Date.now())
  })
  tileLogs.set(app, counter)
  return counter
}
/** canvas-scale-bench 起远看密集场景时加的开关：Chromium 日志进 stderr，才数得到瓦片超限。 */
export const FAR_DENSE_LAUNCH_ARGS = Object.freeze(['--enable-logging=stderr'])
export const FAR_DENSE_LAUNCH_ENV = Object.freeze({ ELECTRON_ENABLE_LOGGING: '1' })

function ffmpegPath() {
  return process.env.FFMPEG_BIN || require('@ffmpeg-installer/ffmpeg').path
}

function ffmpeg(args, { capture = false } = {}) {
  const run = spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 20, ...(capture ? {} : { stdio: ['ignore', 'ignore', 'inherit'] }) })
  if (run.error) throw new Error(`远看密集夹具要 ffmpeg 抽帧：${run.error.message}`)
  if (run.status !== 0) throw new Error(`ffmpeg 抽帧失败（exit ${run.status}）：${args.join(' ')}`)
  return run.stdout
}

/** 预览的 8×8 面积均色（rgb24，192 字节）：量具判「这张图画出来没有」的预期值。 */
function grid8(file) {
  const run = spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'scale=8:8:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 })
  if (run.status !== 0 || run.stdout.length !== 192) throw new Error(`预期格算不出来：${file}`)
  return Array.from(run.stdout)
}

/** 60 张真实帧（原图 + 生产规则预览 + 预期格），按视频内容哈希缓存。 */
function ensureFrames(count) {
  const videoKey = crypto.createHash('sha256').update(fs.readFileSync(SOURCE_VIDEO)).digest('hex').slice(0, 12)
  const cacheDir = path.join(os.tmpdir(), `nomi-canvas-far-dense-v1-${videoKey}`)
  fs.mkdirSync(cacheDir, { recursive: true })
  const gridFile = path.join(cacheDir, 'grids.json')
  const grids = fs.existsSync(gridFile) ? JSON.parse(fs.readFileSync(gridFile, 'utf8')) : {}
  const frames = []
  for (let index = 0; index < count; index += 1) {
    const name = `frame-${String(index).padStart(2, '0')}`
    const original = path.join(cacheDir, `${name}.jpg`)
    const preview = path.join(cacheDir, `${name}.preview.jpg`)
    // 15 秒的片子里均匀取 60 个时刻（每 0.245 秒一帧）：相邻帧也是不同的画面。
    if (!fs.existsSync(original)) ffmpeg(['-ss', (0.12 + index * 0.245).toFixed(3), '-i', SOURCE_VIDEO, '-frames:v', '1', '-q:v', '3', original])
    if (!fs.existsSync(preview)) ffmpeg(['-i', original, '-frames:v', '1', '-vf', "scale='if(gt(iw,ih),min(iw,1024),-2)':'if(gt(iw,ih),-2,min(ih,1024))'", '-q:v', '4', preview])
    const key = path.basename(preview)
    if (!grids[key]) grids[key] = grid8(preview)
    frames.push({ original, preview })
  }
  fs.writeFileSync(gridFile, JSON.stringify(grids))
  return { frames, grids }
}

function localAssetUrl(projectId, relativePath) {
  return `nomi-local://asset/${encodeURIComponent(projectId)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * 建 D60 项目：骨架用通用夹具（项目身份、清单、最近项目表都同一份），节点 / 连线 / 组按反馈现场排。
 * 返回值和 createCanvasPerformanceFixture 同形状，另带 grids（预览文件名 → 预期格）。
 */
export function createFarDenseFixture({ projectsDir, scale }) {
  const config = FAR_DENSE_SCALES[scale]
  if (!config) throw new Error(`未知远看密集规模「${scale}」，可选：${Object.keys(FAR_DENSE_SCALES).join(' / ')}`)
  const projectId = `project-canvas-far-dense-${scale.toLowerCase()}`
  const base = createCanvasPerformanceFixture({ projectsDir, scale: 'empty', withProjectIdentity: true, projectId, projectName: `ZZ Canvas 远看密集 ${scale}`, projectDirName: `ZZ-canvas-far-dense-${scale.toLowerCase()}` })
  const total = config.refs + config.shots + config.images
  const { frames, grids } = ensureFrames(total)
  const assetDir = path.join(base.projectRoot, 'assets', 'generated', 'far-dense')
  fs.mkdirSync(assetDir, { recursive: true })
  const template = JSON.parse(fs.readFileSync(TEMPLATE_PROJECT, 'utf8')).payload.generationCanvas.nodes.find((node) => node.kind === 'image')
  const nodeBase = { ...template }
  delete nodeBase.shotIndex
  delete nodeBase.renderKind
  const nodes = []
  let frameCursor = 0
  const addNode = (id, title, position) => {
    const frame = frames[frameCursor]
    frameCursor += 1
    const files = [frame.original, frame.preview].map((file) => {
      fs.copyFileSync(file, path.join(assetDir, path.basename(file)))
      return `assets/generated/far-dense/${path.basename(file)}`
    })
    nodes.push({
      ...structuredClone(nodeBase),
      id, kind: 'image', categoryId: 'shots', title,
      prompt: `远看密集 ${title}`,
      references: [], history: [], runs: [], status: 'success',
      result: { id: `${id}-result`, type: 'image', url: localAssetUrl(projectId, files[0]), thumbnailUrl: localAssetUrl(projectId, files[1]), previewState: 'ready', createdAt: 1 },
      position, exactPosition: true, size: { ...CARD },
      meta: { ...(nodeBase.meta || {}), technicalReview: undefined, imageWidth: 1920, imageHeight: 1080, imageAspectRatio: 16 / 9, previewHeight: CARD.height, userResized: false },
    })
    return id
  }
  const refIds = Array.from({ length: config.refs }, (_, index) => addNode(`far-ref-${index}`, `参考 ${index + 1}`, { x: 600 + index * 380, y: 0 }))
  const shotIds = Array.from({ length: config.shots }, (_, index) => addNode(`far-shot-${index}`, `镜头 ${index + 1}`, { x: (index % 10) * 380, y: 640 + Math.floor(index / 10) * 280 }))
  const imageIds = Array.from({ length: config.images }, (_, index) => addNode(`far-image-${index}`, `图 ${index + 1}`, { x: 4200 + (index % 5) * 380, y: 640 + Math.floor(index / 5) * 280 }))
  const edges = []
  for (let ref = 0; ref < config.refsPerShot; ref += 1) {
    for (let shot = 0; shot < shotIds.length; shot += 1) edges.push({ id: `far-edge-${ref}-${shot}`, source: refIds[ref], target: shotIds[shot], mode: 'reference', order: ref })
  }
  // createdAt / updatedAt 是 nodeGroupSchema 的必填项：缺了读盘时整组被静默丢掉（canvasSnapshotNormalizer 的 safeParse），
  // 画面上就没有组框——反馈现场恰恰是「组里的卡远看空掉」，没有组框的夹具量不到组底色那一半。
  const groups = [
    { id: 'far-group-refs', name: '参考', categoryId: 'shots', nodeIds: refIds, createdAt: 1, updatedAt: 1 },
    { id: 'far-group-storyboard', name: '分镜', categoryId: 'shots', nodeIds: shotIds, createdAt: 1, updatedAt: 1 },
    { id: 'far-group-images', name: '图片', categoryId: 'shots', nodeIds: imageIds, createdAt: 1, updatedAt: 1 },
  ]
  const record = base.record
  record.payload.generationCanvas = { ...(record.payload.generationCanvas || {}), nodes, edges, groups, selectedNodeIds: [] }
  for (const name of ['project.json', 'project.backup.json']) fs.writeFileSync(path.join(base.projectRoot, '.nomi', name), JSON.stringify(record, null, 1))
  return {
    ...base,
    record,
    grids,
    summary: {
      ...base.summary,
      scale, imageNodes: nodes.length, videoNodes: 0, nodes: nodes.length, edges: edges.length, groups: groups.length, clips: 0,
      imageBytes: frames.slice(0, total).map((frame) => fs.statSync(frame.original).size),
      imagePreviewBytes: frames.slice(0, total).map((frame) => fs.statSync(frame.preview).size),
      videoBytes: [],
      mediaProfile: 'real-frames',
    },
  }
}

// ——— 像素量具 ———————————————————————————————————————————————

/** 页内：每张已解码、可见、整张在视口里的图（画出来的内容框）、组底色的采样点、画布空白处的采样点、卡片占位底色。 */
async function collectTargets(page) {
  return page.evaluate(() => {
    const vw = innerWidth
    const vh = innerHeight
    const parse = (value) => {
      const match = String(value || '').match(/rgba?\(([^)]+)\)/)
      if (!match) return null
      const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number)
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
    }
    const images = []
    for (const node of document.querySelectorAll('.react-flow__node')) {
      for (const img of node.querySelectorAll('img')) {
        if (!img.complete || !img.naturalWidth) continue
        let hidden = false
        for (let el = img; el && el !== node.parentElement; el = el.parentElement) {
          const style = getComputedStyle(el)
          if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.05) { hidden = true; break }
        }
        if (hidden && !img.hasAttribute('data-far-dense-control')) continue
        const box = img.getBoundingClientRect()
        if (box.width < 12 || box.height < 8) continue
        // object-fit: contain → 元素框里真正画内容的那一块。
        const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight)
        const w = img.naturalWidth * scale
        const h = img.naturalHeight * scale
        const x = box.left + (box.width - w) / 2
        const y = box.top + (box.height - h) / 2
        if (x < 0 || y < 0 || x + w > vw || y + h > vh) continue
        // 被别的东西盖住的格子（工具条、菜单、面板压在卡上）不归这张卡答：记成判不出来，不算缺。
        const covered = []
        for (let gy = 1; gy < 7; gy += 1) {
          for (let gx = 1; gx < 7; gx += 1) {
            const hit = document.elementFromPoint(x + (gx + 0.5) * w / 8, y + (gy + 0.5) * h / 8)
            if (!hit || hit.closest('.react-flow__node') !== node) covered.push(gy * 8 + gx)
          }
        }
        images.push({ nodeId: node.getAttribute('data-id') || '', file: decodeURIComponent((img.currentSrc || img.src).split('/').pop() || ''), x, y, w, h, covered, control: img.hasAttribute('data-far-dense-control') })
      }
    }
    const groups = []
    for (const box of document.querySelectorAll('.generation-canvas-v2__group-box[data-group-id]')) {
      const rect = box.getBoundingClientRect()
      const points = []
      for (let y = Math.max(rect.top + 4, 0); y < Math.min(rect.bottom - 4, vh); y += 9) {
        for (let x = Math.max(rect.left + 4, 0); x < Math.min(rect.right - 4, vw); x += 9) {
          if (document.elementFromPoint(x, y) === box) points.push([Math.round(x), Math.round(y)])
        }
      }
      groups.push({ groupId: box.getAttribute('data-group-id'), color: parse(getComputedStyle(box).backgroundColor), points })
    }
    const pane = []
    const paneEl = document.querySelector('.react-flow__pane')
    if (paneEl) {
      const rect = paneEl.getBoundingClientRect()
      for (let y = rect.top + 20; y < rect.bottom - 20 && pane.length <= 400; y += 23) {
        for (let x = rect.left + 20; x < rect.right - 20 && pane.length <= 400; x += 23) {
          if (document.elementFromPoint(x, y) === paneEl) pane.push([Math.round(x), Math.round(y)])
        }
      }
    }
    const placeholderColors = []
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;left:-50px;top:-50px;width:10px;height:10px'
    for (const cls of ['bg-nomi-ink-05', 'bg-nomi-paper', 'bg-nomi-paper/90']) {
      probe.className = cls
      document.body.appendChild(probe)
      const color = parse(getComputedStyle(probe).backgroundColor)
      if (color) placeholderColors.push(color)
      probe.remove()
    }
    return { vw, vh, images, groups, pane, placeholderColors, lightweight: document.querySelectorAll('[data-render-mode="lightweight"]').length }
  })
}

/** 主进程：抓窗口此刻合成出来的那一帧，逐张图 / 逐个组打分。纯算术，位图不出主进程。 */
async function captureAndScore(app, targets, grids) {
  return app.evaluate(async ({ BrowserWindow }, { targets, grids }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    const image = await win.webContents.capturePage()
    const size = image.getSize()
    if (!size.width || !size.height) return { error: 'empty-capture' }
    const bitmap = image.toBitmap()
    const ratio = Math.round(Math.sqrt(bitmap.length / 4 / (size.width * size.height)))
    const width = size.width * Math.max(1, ratio)
    const height = size.height * Math.max(1, ratio)
    const sx = width / targets.vw
    const sy = height / targets.vh
    const px = (x, y) => {
      const ix = Math.min(width - 1, Math.max(0, Math.round(x * sx)))
      const iy = Math.min(height - 1, Math.max(0, Math.round(y * sy)))
      const offset = (iy * width + ix) * 4
      return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]] // BGRA → RGB
    }
    const dist = (a, b) => Math.sqrt(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) / 3)
    const median3 = (values) => [0, 1, 2].map((k) => values.map((value) => value[k]).sort((p, q) => p - q)[Math.floor(values.length / 2)])
    const paneColor = targets.pane.length ? median3(targets.pane.map(([x, y]) => px(x, y))) : [0, 0, 0]
    const over = (color, base) => [0, 1, 2].map((k) => Math.round([color.r, color.g, color.b][k] * color.a + base[k] * (1 - color.a)))
    const blankColors = [paneColor]
    let groupMissing = 0
    let groupDeterminate = 0
    for (const group of targets.groups) {
      const surface = group.color ? over(group.color, paneColor) : paneColor
      blankColors.push(surface)
      if (dist(surface, paneColor) <= 5) continue
      for (const [x, y] of group.points) {
        const samples = []
        for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) samples.push(px(x + dx, y + dy))
        const color = median3(samples)
        groupDeterminate += 1
        if (dist(color, paneColor) < dist(color, surface)) groupMissing += 1
      }
    }
    for (const color of targets.placeholderColors) blankColors.push(over(color, paneColor))
    // 阳性对照当场量到的「图没画时卡上真实的颜色」：算出来的占位色只是近似，真片偏暗时差这一点就判不出来。
    for (const color of targets.measuredBlank ?? []) blankColors.push(color)
    let controlObserved = null
    const cards = []
    for (const roi of targets.images) {
      const expected = grids[roi.file]
      if (!expected) continue
      const x0 = Math.round(roi.x * sx)
      const y0 = Math.round(roi.y * sy)
      const x1 = Math.round((roi.x + roi.w) * sx)
      const y1 = Math.round((roi.y + roi.h) * sy)
      const sums = Array.from({ length: 64 }, () => [0, 0, 0, 0])
      for (let y = y0; y < y1; y += 1) {
        const gy = Math.min(7, Math.floor(((y - y0) / Math.max(1, y1 - y0)) * 8))
        for (let x = x0; x < x1; x += 1) {
          const gx = Math.min(7, Math.floor(((x - x0) / Math.max(1, x1 - x0)) * 8))
          const offset = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4
          const cell = sums[gy * 8 + gx]
          cell[0] += bitmap[offset + 2]; cell[1] += bitmap[offset + 1]; cell[2] += bitmap[offset]; cell[3] += 1
        }
      }
      let missing = 0
      let determinate = 0
      const covered = new Set(roi.covered)
      const inner = []
      for (let index = 0; index < 64; index += 1) {
        const sum = sums[index]
        // 最外一圈格子不计：卡片描边、圆角落在那里。
        if (!sum[3] || index % 8 === 0 || index % 8 === 7 || index < 8 || index >= 56 || covered.has(index)) continue
        const observed = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]]
        inner.push(observed)
        const want = [expected[index * 3], expected[index * 3 + 1], expected[index * 3 + 2]]
        // 判得出的门槛比「算缺」的误差门槛（30）高一点：真空着的格子一定算得上缺，中间没有死区。
        if (Math.min(...blankColors.map((color) => dist(want, color))) < 32) continue
        determinate += 1
        const error = dist(observed, want)
        if (error > 30 && Math.min(...blankColors.map((color) => dist(observed, color))) < error) missing += 1
      }
      if (roi.control && inner.length) controlObserved = median3(inner)
      cards.push({ nodeId: roi.nodeId, control: roi.control, determinate, missing })
    }
    const scored = cards.filter((card) => card.determinate >= 6)
    const blank = scored.filter((card) => card.missing / card.determinate >= 0.5)
    return {
      scoredCards: scored.length,
      blankCards: blank.length,
      blankNodeIds: blank.map((card) => card.nodeId),
      controlObserved,
      controlScored: scored.some((card) => card.control),
      controlBlank: scored.some((card) => card.control && card.missing / card.determinate >= 0.5),
      // 一个组点都没量到 = 不知道（null），不是「没缺」。
      groupMissingRate: groupDeterminate ? groupMissing / groupDeterminate : null,
    }
  }, { targets, grids })
}

async function scoreNow(app, page, grids, measuredBlank = []) {
  const targets = { ...await collectTargets(page), measuredBlank }
  const score = await captureAndScore(app, targets, grids)
  return { ...score, lightweight: targets.lightweight }
}

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null)

/**
 * 阳性对照：藏起一张已解码的图（opacity 0，量具照样按它的框打分），量具必须报出「这一张空了」；
 * 其余卡不该因此变化。报不出来 = 量具这一刻是瞎的，这个样本的缺块率不交。
 */
async function positiveControl(app, page, grids) {
  // 依次试屏上的图：片头那几帧接近黑，颜色和空白分不开，判不出来（这种图既不算过也不算没过）。
  for (let candidate = 0; candidate < 12; candidate += 1) {
    const marked = await page.evaluate((index) => {
      const onScreen = [...document.querySelectorAll('.react-flow__node img')].filter((img) => {
        if (!img.complete || !img.naturalWidth) return false
        const box = img.getBoundingClientRect()
        return box.width > 20 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
      })
      const img = onScreen[Math.floor((index * onScreen.length) / 12)]
      if (!img) return false
      img.setAttribute('data-far-dense-control', '1')
      img.style.setProperty('opacity', '0', 'important')
      return true
    }, candidate)
    if (!marked) return { ok: false, measuredBlank: [] }
    await page.waitForTimeout(250)
    // 先量这张卡现在真实的颜色（图藏了，露出来的就是「没画」的样子），再带上它打分。
    // 截图要是过时的（图其实还在），量到的是图自己的颜色，打分照样报不出「空了」，对照不会自己骗自己。
    const measuredBlank = (await scoreNow(app, page, grids)).controlObserved
    const score = await scoreNow(app, page, grids, measuredBlank ? [measuredBlank] : [])
    await page.evaluate(() => {
      const img = document.querySelector('img[data-far-dense-control]')
      img?.style.removeProperty('opacity')
      img?.removeAttribute('data-far-dense-control')
    })
    await page.waitForTimeout(250)
    if (score.controlScored) return { ok: Boolean(score.controlBlank), measuredBlank: measuredBlank ? [measuredBlank] : [] }
  }
  return { ok: false, measuredBlank: [] }
}

async function waitImagesSettled(page, maxMs = 30_000) {
  const until = Date.now() + maxMs
  let stable = 0
  let previous = ''
  while (Date.now() < until && stable < 3) {
    await page.waitForTimeout(300)
    const key = await page.evaluate(() => {
      const images = [...document.querySelectorAll('.react-flow__node img')]
      return `${document.querySelectorAll('.react-flow__node').length}:${images.length}:${images.filter((image) => image.complete && image.naturalWidth).length}:${document.querySelectorAll('.generation-canvas-v2-node__media-loading').length}`
    })
    stable = key === previous && key.endsWith(':0') ? stable + 1 : 0
    previous = key
  }
}

async function groupCenter(page, groupId) {
  return page.evaluate((id) => {
    const rect = document.querySelector(`.generation-canvas-v2__group-box[data-group-id="${id}"]`)?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  }, groupId)
}

/** 页内结构读数（确定性，不看显卡）：屏上每张卡多少 DOM、挂着的图解码后多少像素、几个 <video>。 */
async function readStructure(page) {
  return page.evaluate(() => {
    const vw = innerWidth
    const vh = innerHeight
    const onScreen = [...document.querySelectorAll('.react-flow__node')].filter((node) => {
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < vw && rect.top < vh
    })
    const perCard = onScreen.map((node) => node.querySelectorAll('*').length + 1).sort((a, b) => a - b)
    const decoded = [...document.querySelectorAll('.react-flow img')].filter((img) => img.complete && img.naturalWidth)
    const decodedPx = decoded.reduce((sum, img) => sum + img.naturalWidth * img.naturalHeight, 0)
    return {
      dpr: devicePixelRatio,
      onScreen: onScreen.length,
      cardDom: perCard.length ? perCard[Math.floor(perCard.length / 2)] : null,
      decodedOverScreen: Math.round((decodedPx / (vw * vh * devicePixelRatio * devicePixelRatio)) * 100) / 100,
      videos: document.querySelectorAll('.react-flow video').length,
      lightweight: document.querySelectorAll('[data-render-mode="lightweight"]').length,
    }
  })
}

/** 合成层数（CDP LayerTree；层由 DOM 和样式决定，不看显卡）。 */
export async function countLayers(page) {
  const cdp = await page.context().newCDPSession(page)
  try {
    let layers = null
    cdp.on('LayerTree.layerTreeDidChange', (event) => { if (event.layers) layers = event.layers })
    await cdp.send('LayerTree.enable')
    // 画面静止时没有新提交，这个事件不来：翻一个 1px 小元素的透明度逼出提交（透明度不成层，不影响数）。
    await page.evaluate(() => {
      const nudge = document.createElement('div')
      nudge.setAttribute('data-far-dense-nudge', '')
      nudge.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;background:#000;opacity:.99;pointer-events:none'
      document.body.appendChild(nudge)
    })
    for (let attempt = 0; attempt < 30 && !layers; attempt += 1) {
      await page.evaluate((flip) => { document.querySelector('[data-far-dense-nudge]')?.style.setProperty('opacity', flip ? '.98' : '.99') }, attempt % 2 === 0)
      await page.waitForTimeout(100)
    }
    await page.evaluate(() => document.querySelector('[data-far-dense-nudge]')?.remove())
    await cdp.send('LayerTree.disable').catch(() => {})
    return layers ? layers.length : null
  } finally {
    await cdp.detach().catch(() => {})
  }
}

/** 几段计帧窗口拼成一段（每档缩放各一段，中间调缩放、等出图的那几秒不算进手势）。 */
function mergeRaw(raws) {
  const list = raws.filter(Boolean)
  if (!list.length) return null
  const touched = list.map((raw) => raw.medianTouchedPerFlush).sort((a, b) => a - b)
  return {
    elapsedMs: list.reduce((sum, raw) => sum + raw.elapsedMs, 0),
    frames: list.reduce((sum, raw) => sum + raw.frames, 0),
    gaps: list.flatMap((raw) => raw.gaps),
    longTasks: list.flatMap((raw) => raw.longTasks),
    nodeStyleWrites: list.reduce((sum, raw) => sum + raw.nodeStyleWrites, 0),
    distinctTouchedNodes: Math.max(...list.map((raw) => raw.distinctTouchedNodes)),
    maxTouchedPerFlush: Math.max(...list.map((raw) => raw.maxTouchedPerFlush)),
    medianTouchedPerFlush: touched[Math.floor(touched.length / 2)],
    flushes: list.reduce((sum, raw) => sum + raw.flushes, 0),
    subtreeMutations: list.reduce((sum, raw) => sum + raw.subtreeMutations, 0),
    mountedNodes: Math.max(...list.map((raw) => raw.mountedNodes)),
  }
}

function gapP95(raw) {
  const gaps = (raw?.gaps ?? []).filter((gap) => gap >= 0).sort((a, b) => a - b)
  return gaps.length ? Math.round(gaps[Math.min(gaps.length - 1, Math.ceil(gaps.length * 0.95) - 1)] * 10) / 10 : null
}

/**
 * 一个样本：先凑到分镜组里看清（缩到约 100%）——用户就是这么来回看的，也是合成层保留高分辨率栅格的最坏路径；
 * 然后依次退到 20% / 35% / 55%，每一档：等出图 → 结构读数 + 合成层数 →（第一档）阳性对照 → 停稳缺块率 →
 * 计帧窗口里平移一圈 + 滚轮来回（停在这一档附近）→ 移动中抓 8 帧（只看）→ 停下 0.4s / 0.8s 各抓一帧（取较差的）。
 * 主数 blankCardPct 取各档里最差的一档；帧数据各档的窗口拼成一段（中间调缩放、等出图的那几秒不算）。
 */
export async function runFarDensePan(page, { app, fixture, startWindow, stopWindow, stageBox, readViewport, tileLog = false, expectedDpr = null }) {
  const grids = fixture.grids
  if (!grids) throw new Error('far-dense-pan 要 D60 夹具（带预期格）：--scales D60')
  const tiles = tileLog ? tileOomCounter(app) : null
  const sampleStartedAt = Date.now()
  await page.keyboard.press('Escape').catch(() => {})
  await canvasSetZoomPercent(page, FAR_DENSE_ZOOMS[0], 'far-dense: 先缩远')
  await waitImagesSettled(page)
  // 量具前提：夹具的组在 20% 下全在屏上。组被读盘静默丢掉（缺必填字段）时这里直接停，不交一份「没有组」的绿数。
  const groupBoxes = await page.evaluate(() => document.querySelectorAll('.generation-canvas-v2__group-box[data-group-id]').length)
  if (groupBoxes < (fixture.summary?.groups ?? 0)) throw new Error(`far-dense: 夹具 ${fixture.summary?.groups} 个组只画出 ${groupBoxes} 个——组被读盘丢掉了，量具前提不成立`)
  const storyboard = await groupCenter(page, 'far-group-storyboard')
  if (storyboard) {
    await page.mouse.move(storyboard.x, storyboard.y)
    for (let tick = 0; tick < 60; tick += 1) {
      const { zoom } = await readViewport(page)
      if (zoom !== null && zoom >= 1) break
      await page.mouse.wheel(0, -100)
      await page.waitForTimeout(40)
    }
    await page.waitForTimeout(800)
    await waitImagesSettled(page, 15_000)
  }

  const raws = []
  const levels = []
  let oracleControl = null
  let measuredBlank = []
  let movingWorst = 0
  for (const percent of FAR_DENSE_ZOOMS) {
    await canvasSetZoomPercent(page, percent, `far-dense: 退到 ${percent}%`)
    await page.waitForTimeout(1200)
    await waitImagesSettled(page, 15_000)
    const structure = await readStructure(page)
    // 量具前提：真在指定的设备像素比上（判定条件就是它）。不是就停，不交别的屏幕的数。
    if (expectedDpr && Math.abs(structure.dpr - Number(expectedDpr)) > 0.01) throw new Error(`far-dense: ${percent}% 时设备像素比 ${structure.dpr}，要的是 ${expectedDpr}`)
    const layers = await countLayers(page)
    if (oracleControl === null) {
      const control = await positiveControl(app, page, grids)
      oracleControl = control.ok
      measuredBlank = control.measuredBlank
    }

    const stage = await stageBox(page)
    const origin = { x: stage.x + stage.width * 0.5, y: stage.y + stage.height * 0.45 }
    await page.evaluate(() => document.activeElement?.blur?.())
    await page.mouse.move(origin.x, origin.y)
    await page.keyboard.down('Space')
    await page.mouse.down()
    await startWindow(page)
    for (let step = 1; step <= 120; step += 1) {
      const angle = (step / 120) * Math.PI * 2
      await page.mouse.move(origin.x + Math.sin(angle) * 160, origin.y + (1 - Math.cos(angle)) * 80, { steps: 1 })
      await page.waitForTimeout(14)
    }
    await page.mouse.up()
    await page.keyboard.up('Space')
    const wheelAt = (await groupCenter(page, 'far-group-storyboard')) || origin
    await page.mouse.move(wheelAt.x, wheelAt.y)
    // 进 4 格、退 4 格，来回三次（约 ±1.25 倍）：每一档的滚轮都停在这一档附近，不跨到别的档去。
    for (let tick = 0; tick < 24; tick += 1) {
      await page.mouse.wheel(0, Math.floor(tick / 4) % 2 === 0 ? -40 : 40)
      await page.waitForTimeout(45)
    }
    const raw = await stopWindow(page)
    raws.push(raw)
    // 滚轮来回之后回到这一档的整数缩放，再量移动中 / 停稳的缺块。
    await canvasSetZoomPercent(page, percent, `far-dense: 回到 ${percent}%`)
    await page.waitForTimeout(600)

    await page.mouse.move(origin.x, origin.y)
    await page.keyboard.down('Space')
    await page.mouse.down()
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(origin.x + (step % 2 ? 60 : -20) * Math.ceil(step / 2), origin.y + 25 * (step % 3), { steps: 1 })
      await page.waitForTimeout(34)
      const score = await scoreNow(app, page, grids, measuredBlank)
      movingWorst = Math.max(movingWorst, pct(score.blankCards, score.scoredCards) ?? 0)
    }
    await page.mouse.up()
    await page.keyboard.up('Space')
    const settled = []
    for (const waitMs of [400, 800]) {
      await page.waitForTimeout(waitMs)
      settled.push(await scoreNow(app, page, grids, measuredBlank))
    }
    const worst = settled.reduce((acc, score) => ((pct(score.blankCards, score.scoredCards) ?? 0) >= (pct(acc.blankCards, acc.scoredCards) ?? 0) ? score : acc), settled[0])
    levels.push({
      percent, structure, layers, frameP95: gapP95(raw),
      blankPct: worst.scoredCards ? pct(worst.blankCards, worst.scoredCards) : null,
      groupMissingPct: (() => {
        const rates = settled.map((score) => score.groupMissingRate).filter((rate) => typeof rate === 'number')
        return rates.length ? Math.round(Math.max(...rates) * 1000) / 10 : null
      })(),
      scoredCards: worst.scoredCards, lightweight: worst.lightweight, blankNodeIds: worst.blankNodeIds,
    })
  }

  const at = (percent) => levels.find((level) => level.percent === percent)
  const far = levels.filter((level) => level.percent < DETAIL_LINE_PERCENT)
  const maxOf = (values) => {
    const numbers = values.filter((value) => typeof value === 'number' && Number.isFinite(value))
    return numbers.length ? Math.max(...numbers) : undefined
  }
  const worstLevel = levels.reduce((acc, level) => ((level.blankPct ?? -1) > (acc.blankPct ?? -1) ? level : acc), levels[0])
  const viewport = await readViewport(page)
  return {
    raw: mergeRaw(raws),
    viewport,
    path: `far-dense（${FAR_DENSE_ZOOMS.join(' / ')}%：平移 + 滚轮，像素量具 + 结构读数${tileLog ? ' + 瓦片超限日志' : ''}）`,
    // 阳性对照没过：这一刻量具是瞎的，不交缺块率（统一跑法判 no-data → 红），其余数照交。
    blankCardPct: oracleControl ? maxOf(levels.map((level) => level.blankPct)) : undefined,
    blankPct20: oracleControl ? at(20)?.blankPct ?? undefined : undefined,
    blankPct35: oracleControl ? at(35)?.blankPct ?? undefined : undefined,
    blankPct55: oracleControl ? at(55)?.blankPct ?? undefined : undefined,
    blankCardPctMoving: oracleControl ? movingWorst : undefined,
    groupMissingPct: oracleControl ? maxOf(levels.map((level) => level.groupMissingPct)) : undefined,
    scoredCards: worstLevel?.scoredCards,
    lightweightCards: worstLevel?.lightweight,
    oracleControl: oracleControl ? 1 : 0,
    blankNodeIds: worstLevel?.blankNodeIds,
    tileOomLines: tiles ? tiles.at.filter((time) => time >= sampleStartedAt).length : undefined,
    farCardDom: maxOf(far.map((level) => level.structure.cardDom)),
    cardDom55: at(55)?.structure.cardDom ?? undefined,
    canvasVideos: maxOf(levels.map((level) => level.structure.videos)),
    decodedOverScreen: maxOf(levels.map((level) => level.structure.decodedOverScreen)),
    layers: maxOf(far.map((level) => level.layers)),
    layers55: at(55)?.layers ?? undefined,
    frameP95At20: at(20)?.frameP95 ?? undefined,
    frameP95At35: at(35)?.frameP95 ?? undefined,
    frameP95At55: at(55)?.frameP95 ?? undefined,
  }
}
