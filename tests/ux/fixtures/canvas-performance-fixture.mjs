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
  S: { imageCount: 24, videoCount: 24, edgeCount: 96, clipCount: 12 },
  M: { imageCount: 48, videoCount: 48, edgeCount: 192, clipCount: 24 },
  L: { imageCount: 96, videoCount: 96, edgeCount: 384, clipCount: 48 },
  XL: { imageCount: 160, videoCount: 160, edgeCount: 640, clipCount: 80 },
  // 2026-09-12 规模调查（docs/research/2026-09-12-canvas-perf-at-scale/）：
  // 创始人报的场景是「**图片**多、选中一大批拖动」，不是图/视频各半。视频节点自带
  // <video> 解码与播放态，会把「图片多」这条曲线里的成本盖掉，所以这三档是纯图片档，
  // 节点数就是图片数（60 / 150 / 300），边按 N/2 给一点真实密度，时间轴留空。
  I60: { imageCount: 60, videoCount: 0, edgeCount: 30, clipCount: 0 },
  I150: { imageCount: 150, videoCount: 0, edgeCount: 75, clipCount: 0 },
  I300: { imageCount: 300, videoCount: 0, edgeCount: 150, clipCount: 0 },
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
    videoBytes: VIDEO_ASSETS.map((asset) => fs.statSync(path.join(outputDir, asset.name)).size),
  }
}

function localAssetUrl(projectId, relativePath) {
  return `nomi-local://asset/${encodeURIComponent(projectId)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

function gridPosition(index, columns = 12) {
  return {
    x: 80 + (index % columns) * 390,
    y: 80 + Math.floor(index / columns) * 300,
  }
}

function buildNode(template, { id, kind, title, index, projectId, relativePath }) {
  const node = clone(template || {})
  const width = 320
  const height = 180
  const url = localAssetUrl(projectId, relativePath)
  const result = {
    id: `${id}-result`,
    type: kind,
    url,
    thumbnailUrl: kind === 'image' ? url : undefined,
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
    timeline: buildTimeline(snapshot.payload?.timeline, nodes, config.clipCount),
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
      videoBytes: assets.videoBytes,
    },
  }
}

export function defaultPerfTempRoot(label = 'run') {
  return path.join(os.tmpdir(), `nomi-canvas-performance-${label}-${process.pid}`)
}
