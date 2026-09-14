import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const bundledFfmpegPath = require('@ffmpeg-installer/ffmpeg').path
const fixtureDir = path.dirname(fileURLToPath(import.meta.url))
const snapshotPath = path.join(fixtureDir, 'perf-heavy.project.json')
const DEFAULT_ASSET_CACHE = path.join(os.tmpdir(), 'nomi-canvas-performance-assets-v2')

export const CANVAS_PERF_SCALES = Object.freeze({
  empty: { imageCount: 0, videoCount: 0, edgeCount: 0, clipCount: 0 },
  REAL: { imageCount: 4, videoCount: 1, edgeCount: 4, clipCount: 1 },
  REALIMG: { imageCount: 4, videoCount: 0, edgeCount: 0, clipCount: 0 },
  SIMG: { imageCount: 48, videoCount: 0, edgeCount: 0, clipCount: 0 },
  MIMG: { imageCount: 96, videoCount: 0, edgeCount: 0, clipCount: 0 },
  LIMG: { imageCount: 192, videoCount: 0, edgeCount: 0, clipCount: 0 },
  XLIMG: { imageCount: 320, videoCount: 0, edgeCount: 0, clipCount: 0 },
  S: { imageCount: 24, videoCount: 24, edgeCount: 96, clipCount: 12 },
  M: { imageCount: 48, videoCount: 48, edgeCount: 192, clipCount: 24 },
  L: { imageCount: 96, videoCount: 96, edgeCount: 384, clipCount: 48 },
  XL: { imageCount: 160, videoCount: 160, edgeCount: 640, clipCount: 80 },
})

const IMAGE_ASSETS = [
  { name: 'image-960.png', width: 960, height: 540, color: '0x31465f' },
  { name: 'image-1920.png', width: 1920, height: 1080, color: '0x8b4d39' },
]
const VIDEO_ASSETS = [
  { name: 'video-720-a.mp4', width: 1280, height: 720, color: 'blue' },
  { name: 'video-720-b.mp4', width: 1280, height: 720, color: 'darkgreen' },
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function runFfmpeg(args) {
  const result = spawnSync(process.env.FFMPEG_BIN || bundledFfmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
  })
  if (result.error) {
    throw new Error(`画布性能夹具需要 ffmpeg 生成本地视频/图片：${result.error.message}`)
  }
  if (result.status !== 0) throw new Error(`ffmpeg 生成夹具失败（exit ${result.status}）`)
}

function ensureSyntheticAssets(projectRoot) {
  const outputDir = path.join(projectRoot, 'assets', 'generated', 'canvas-performance')
  const realAssetDir = process.env.NOMI_CANVAS_PERF_REAL_ASSET_DIR
  if (realAssetDir) {
    const candidates = fs.readdirSync(realAssetDir)
      .filter((name) => /\.(png|jpe?g|webp|mov|mp4|m4v)$/i.test(name))
      .sort()
    const imageNames = candidates.filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    const videoNames = candidates.filter((name) => /\.(mov|mp4|m4v)$/i.test(name))
    if (imageNames.length === 0 || (videoNames.length === 0 && process.env.NOMI_CANVAS_PERF_ALLOW_IMAGE_ONLY !== '1')) {
      throw new Error(`真实媒体夹具需要至少一张图片${process.env.NOMI_CANVAS_PERF_ALLOW_IMAGE_ONLY === '1' ? '' : '和一个视频'}：${realAssetDir}`)
    }
    fs.mkdirSync(outputDir, { recursive: true })
    for (const name of [...imageNames, ...videoNames]) {
      const target = path.join(outputDir, name)
      try { fs.unlinkSync(target) } catch (error) { if (error?.code !== 'ENOENT') throw error }
      // The asset resolver intentionally rejects paths escaping the project root.
      // Copy every real asset into the project. The desktop asset inventory
      // intentionally treats linked files conservatively; a real copy keeps
      // the fixture faithful to an imported project and avoids platform-specific
      // symlink/hardlink semantics.
      if (/\.(png|jpe?g|webp)$/i.test(name)) fs.copyFileSync(path.join(realAssetDir, name), target)
      else fs.copyFileSync(fs.realpathSync(path.join(realAssetDir, name)), target)
    }
    const videoPosterUrls = videoNames.map((name, index) => {
      const posterName = `video-poster-${index}.jpg`
      const posterPath = path.join(outputDir, posterName)
      if (!fs.existsSync(posterPath)) {
        runFfmpeg(['-ss', '0', '-i', path.join(realAssetDir, name), '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', posterPath])
      }
      return `assets/generated/canvas-performance/${posterName}`
    })
    const imagePreviewUrls = imageNames.map((name, index) => {
      const previewName = `image-preview-${index}.jpg`
      const previewPath = path.join(outputDir, previewName)
      if (!fs.existsSync(previewPath)) {
        runFfmpeg(['-i', path.join(realAssetDir, name), '-vf', 'scale=640:-2', '-frames:v', '1', '-q:v', '6', previewPath])
      }
      return `assets/generated/canvas-performance/${previewName}`
    })
    return {
      imageUrls: imageNames.map((name) => `assets/generated/canvas-performance/${name}`),
      imagePreviewUrls,
      videoUrls: videoNames.map((name) => `assets/generated/canvas-performance/${name}`),
      imageBytes: imageNames.map((name) => fs.statSync(path.join(realAssetDir, name)).size),
      imagePreviewBytes: imagePreviewUrls.map((relative) => fs.statSync(path.join(projectRoot, relative)).size),
      videoBytes: videoNames.map((name) => fs.statSync(path.join(realAssetDir, name)).size),
      videoPosterUrls,
      mediaProfile: 'real-assets',
    }
  }
  const cacheDir = path.resolve(process.env.NOMI_CANVAS_PERF_ASSET_CACHE || DEFAULT_ASSET_CACHE)
  fs.mkdirSync(outputDir, { recursive: true })
  fs.mkdirSync(cacheDir, { recursive: true })
  for (const asset of IMAGE_ASSETS) {
    const cached = path.join(cacheDir, asset.name)
    if (!fs.existsSync(cached)) {
      runFfmpeg([
        '-f', 'lavfi',
        '-i', `testsrc2=size=${asset.width}x${asset.height}:rate=1`,
        '-vf', `drawbox=x=0:y=0:w=iw:h=ih:color=${asset.color}@0.18:t=fill`,
        '-frames:v', '1',
        '-c:v', 'png',
        cached,
      ])
    }
    fs.copyFileSync(cached, path.join(outputDir, asset.name))
  }
  for (const asset of VIDEO_ASSETS) {
    const cached = path.join(cacheDir, asset.name)
    if (!fs.existsSync(cached)) {
      runFfmpeg([
        '-f', 'lavfi',
        '-i', `testsrc2=size=${asset.width}x${asset.height}:rate=24`,
        '-vf', `drawbox=x=0:y=0:w=iw:h=ih:color=${asset.color}@0.20:t=fill`,
        '-t', '2',
        '-an',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '35',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        cached,
      ])
    }
    fs.copyFileSync(cached, path.join(outputDir, asset.name))
  }
  return {
    imageUrls: IMAGE_ASSETS.map((asset) => `assets/generated/canvas-performance/${asset.name}`),
    videoUrls: VIDEO_ASSETS.map((asset) => `assets/generated/canvas-performance/${asset.name}`),
    imageBytes: IMAGE_ASSETS.map((asset) => fs.statSync(path.join(outputDir, asset.name)).size),
    imagePreviewBytes: IMAGE_ASSETS.map((asset) => fs.statSync(path.join(outputDir, asset.name)).size),
    videoBytes: VIDEO_ASSETS.map((asset) => fs.statSync(path.join(outputDir, asset.name)).size),
    mediaProfile: 'synthetic-preview',
  }
}

function localAssetUrl(projectId, relativePath) {
  return `nomi-local://asset/${encodeURIComponent(projectId)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

function assertFixtureAssetIntegrity(projectRoot, assets) {
  const root = fs.realpathSync(projectRoot)
  const paths = [...assets.imageUrls, ...(assets.imagePreviewUrls || []), ...assets.videoUrls, ...(assets.videoPosterUrls || [])]
  for (const relativePath of paths) {
    const absolutePath = path.resolve(projectRoot, relativePath)
    if (!fs.existsSync(absolutePath)) throw new Error(`画布性能夹具资产缺失：${absolutePath}`)
    const realPath = fs.realpathSync(absolutePath)
    const relative = path.relative(root, realPath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`画布性能夹具资产越出项目根目录：${relativePath} -> ${realPath}`)
    }
  }
}

function gridPosition(index, columns = 12) {
  return {
    x: 80 + (index % columns) * 390,
    y: 80 + Math.floor(index / columns) * 300,
  }
}

function buildNode(template, { id, kind, title, index, projectId, relativePath, thumbnailPath }) {
  const node = clone(template || {})
  const width = 320
  const height = 180
  const url = localAssetUrl(projectId, relativePath)
  const result = {
    id: `${id}-result`,
    type: kind,
    url,
    thumbnailUrl: thumbnailPath ? localAssetUrl(projectId, thumbnailPath) : kind === 'image' ? url : undefined,
    createdAt: 1,
  }
  if (result.thumbnailUrl === undefined) delete result.thumbnailUrl
  return {
    ...node,
    id,
    kind,
    categoryId: 'shots',
    title,
    prompt: `Canvas performance fixture ${kind} ${index + 1}`,
    references: [],
    history: [],
    runs: [],
    status: 'success',
    result,
    position: gridPosition(index),
    exactPosition: true,
    size: { width, height },
    meta: {
      ...(node.meta || {}),
      imageWidth: kind === 'image' ? 960 : undefined,
      imageHeight: kind === 'image' ? 540 : undefined,
      imageAspectRatio: kind === 'image' ? 16 / 9 : undefined,
      videoWidth: kind === 'video' ? 1280 : undefined,
      videoHeight: kind === 'video' ? 720 : undefined,
      videoAspectRatio: kind === 'video' ? 16 / 9 : undefined,
      previewHeight: height,
      userResized: false,
    },
  }
}

function buildEdges(nodes, requestedCount) {
  const edges = []
  const seen = new Set()
  let cursor = 0
  let order = 0
  while (edges.length < requestedCount && nodes.length > 1) {
    const source = nodes[cursor % nodes.length]
    const target = nodes[(cursor + 1 + (cursor % Math.max(1, nodes.length - 1))) % nodes.length]
    cursor += 1
    if (!source || !target || source.id === target.id) continue
    const key = `${source.id}->${target.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const imageToVideo = source.kind === 'image' && target.kind === 'video'
    edges.push({
      id: `canvas-perf-edge-${order}`,
      source: source.id,
      target: target.id,
      mode: imageToVideo ? 'first_frame' : order % 5 === 0 ? 'style_ref' : 'reference',
      order: order % 3,
    })
    order += 1
  }
  return edges
}

function buildTimeline(baseTimeline, nodes, clipCount) {
  const videoNodes = nodes.filter((node) => node.kind === 'video')
  const clips = []
  for (let index = 0; index < clipCount; index += 1) {
    const node = videoNodes[index % Math.max(1, videoNodes.length)] || nodes[index % Math.max(1, nodes.length)]
    clips.push({
      id: `canvas-perf-clip-${index}`,
      type: 'video',
      sourceNodeId: node?.id || '',
      label: `性能镜头 ${index + 1}`,
      startFrame: index * 60,
      endFrame: index * 60 + 60,
      frameCount: 60,
      offsetStartFrame: 0,
      offsetEndFrame: 0,
      url: node?.result?.url,
      thumbnailUrl: node?.result?.thumbnailUrl || node?.result?.url,
    })
  }
  return {
    ...(baseTimeline || {}),
    version: 1,
    fps: 24,
    playheadFrame: 0,
    tracks: [
      { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
      { id: 'videoTrack', type: 'video', label: '视频轨', clips },
    ],
  }
}

export function createCanvasPerformanceFixture({ projectsDir, scale = 'M', projectId, projectName } = {}) {
  const config = CANVAS_PERF_SCALES[scale]
  if (!config) throw new Error(`未知画布性能规模「${scale}」，可选：${Object.keys(CANVAS_PERF_SCALES).join(', ')}`)
  if (!projectsDir) throw new Error('projectsDir is required')
  const rootProjectsDir = path.resolve(projectsDir)
  const id = projectId || `project-canvas-perf-${scale.toLowerCase()}`
  const name = projectName || `ZZ Canvas 性能 ${scale}`
  const projectRoot = path.join(rootProjectsDir, `ZZ-canvas-performance-${scale.toLowerCase()}`)
  const projectManifestDir = path.join(projectRoot, '.nomi')
  fs.mkdirSync(projectManifestDir, { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'assets', 'imported'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'exports'), { recursive: true })
  const assets = ensureSyntheticAssets(projectRoot)
  assertFixtureAssetIntegrity(projectRoot, assets)
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
  const templates = snapshot.payload?.generationCanvas?.nodes || []
  const imageTemplate = templates.find((node) => node.kind === 'image')
  const videoTemplate = templates.find((node) => node.kind === 'video')
  const nodes = []
  // Interleave media kinds so every viewport slice exercises both image and
  // video rendering instead of putting all videos below the initial viewport.
  for (let index = 0; index < Math.max(config.imageCount, config.videoCount); index += 1) {
    if (index < config.imageCount) {
      nodes.push(buildNode(imageTemplate, {
        id: `canvas-perf-image-${index}`,
        kind: 'image',
        title: `性能图片 ${index + 1}`,
        index: nodes.length,
        projectId: id,
        relativePath: assets.imageUrls[index % assets.imageUrls.length],
        thumbnailPath: (assets.imagePreviewUrls || assets.imageUrls)[index % (assets.imagePreviewUrls || assets.imageUrls).length],
      }))
    }
    if (index < config.videoCount) {
      nodes.push(buildNode(videoTemplate, {
        id: `canvas-perf-video-${index}`,
        kind: 'video',
        title: `性能视频 ${index + 1}`,
        index: nodes.length,
        projectId: id,
        relativePath: assets.videoUrls[index % assets.videoUrls.length],
        thumbnailPath: assets.videoPosterUrls?.[index % assets.videoPosterUrls.length],
      }))
    }
  }
  const payload = {
    ...clone(snapshot.payload),
    generationCanvas: {
      ...(snapshot.payload?.generationCanvas || {}),
      nodes,
      edges: buildEdges(nodes, config.edgeCount),
      groups: [],
      selectedNodeIds: [],
    },
    // 画布专项（NOMI_CANVAS_PERF_CANVAS_ONLY=1）：时间轴不放任何 clip。直接克隆快照时间轴会带上快照里
    // 根本没拷进夹具项目的素材引用 → 项目库判「缺少 20 个素材」弹同步对话框，项目根本打不开。
    timeline: buildTimeline(snapshot.payload?.timeline, nodes, process.env.NOMI_CANVAS_PERF_CANVAS_ONLY === '1' ? 0 : config.clipCount),
  }
  const now = Date.now()
  const record = {
    ...clone(snapshot),
    id,
    name,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    revision: 1,
    lastKnownRootPath: path.resolve(projectRoot),
    payload,
  }
  fs.writeFileSync(path.join(projectManifestDir, 'project.json'), JSON.stringify(record, null, 1))
  fs.mkdirSync(rootProjectsDir, { recursive: true })
  fs.writeFileSync(
    path.join(rootProjectsDir, 'recent-workspaces.json'),
    JSON.stringify([{ id, name, rootPath: path.resolve(projectRoot), lastOpenedAt: now, missing: false }], null, 2),
  )
  return {
    record,
    projectRoot,
    projectsDir: rootProjectsDir,
    summary: {
      scale,
      imageNodes: config.imageCount,
      videoNodes: config.videoCount,
      nodes: nodes.length,
      edges: record.payload.generationCanvas.edges.length,
      clips: config.clipCount,
      imageBytes: assets.imageBytes,
      imagePreviewBytes: assets.imagePreviewBytes,
      videoBytes: assets.videoBytes,
      mediaProfile: assets.mediaProfile,
    },
  }
}

export function defaultPerfTempRoot(label = 'run') {
  return path.join(os.tmpdir(), `nomi-canvas-performance-${label}-${process.pid}`)
}
