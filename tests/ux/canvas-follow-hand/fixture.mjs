// 画布跟手量具 · 夹具：用户那块画布的磁盘项目（已保存项目，和 at-mention-edge 走查同一构造法）。
//
// 形状照用户现场（2026-09-24/25 原话：30 多个 15 秒 1080p 生成视频节点，素材十几个）：
//   32 个「生成成功」的视频节点（同一段真实 15 秒 1080p 片子，每个节点一份硬链接）
//   + 12 个图片素材节点（docs/audit 里真实生成的图）+ 31 个文本节点 + 1 个待写的视频节点（打字 / @ / 滑杆都在它上面做）
//   = 76 个节点，低于轻量渲染门槛 80——正是没人量过的那个区间。
// 视频节点**不带** result.thumbnailUrl（老项目就是这样，改后构建打开时后台补封面）；带已量过的 meta.videoWidth/Height
// （老版本打开过一次就会量好并存盘）。尺寸从文件探出来，不硬写。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const scriptRepo = path.resolve(here, '../../..')
const requireHere = createRequire(import.meta.url)

export const IDLE_NODE = 'gen-v2-video-idle'
const AUDIT_IMAGES = 'docs/audit/2026-08-20-l3-f1-full-journey'

export function ffmpegPath() {
  return requireHere('@ffmpeg-installer/ffmpeg').path
}

/** 从文件探出宽高与时长（ffmpeg -i 的头信息）。 */
export function probeMedia(file) {
  const out = spawnSync(ffmpegPath(), ['-hide_banner', '-i', file], { encoding: 'utf8' })
  const text = `${out.stderr || ''}${out.stdout || ''}`
  const dim = text.match(/Stream #\d+:\d+[^\n]*?(?:Video|Image)?[^\n]*?,\s*(\d{2,5})x(\d{2,5})/)
  const dur = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!dim) throw new Error(`探不出媒体尺寸：${file}\n${text.slice(0, 400)}`)
  const durationSeconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null
  return { width: Number(dim[1]), height: Number(dim[2]), durationSeconds, bytes: fs.statSync(file).size }
}

/** 视频由调用方给（入口默认从真实素材登记表取）；这里不留第二个默认值。 */
export function resolveMedia({ video, images } = {}) {
  if (!video) throw new Error('缺视频素材路径（入口默认从 tests/ux/real-media-fixtures.json 取；不许退回合成素材，也不许跳过）')
  const videoFile = path.resolve(video)
  if (!fs.existsSync(videoFile)) {
    throw new Error(`缺真实视频素材 ${videoFile}（不许退回合成素材，也不许跳过）`)
  }
  const imageDir = path.resolve(images || path.join(scriptRepo, AUDIT_IMAGES))
  const imageFiles = fs.readdirSync(imageDir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => path.join(imageDir, f))
  if (imageFiles.length < 2) throw new Error(`图片素材目录里真实图不足 2 张：${imageDir}`)
  return { videoFile, videoMeta: probeMedia(videoFile), imageFiles: imageFiles.map((file) => ({ file, meta: probeMedia(file) })) }
}

function linkOrCopy(src, dest) {
  if (fs.existsSync(dest)) return
  try { fs.linkSync(src, dest) } catch { fs.copyFileSync(src, dest) }
}

const TEXT_LINES = [
  '第一幕：夜班便利店，雨从玻璃门外斜着打进来，店员在整理货架。',
  '她听见门铃响，抬头却没有人，只有地上一串湿脚印通向后门。',
  '镜头贴着地面推进，脚印在仓库门口消失，门缝里透出冷光。',
  '回忆闪回：白天的街口，同一个店员把伞递给一个陌生的小孩。',
  '第二幕：仓库里堆满纸箱，最里面一格亮着一台旧电视机，雪花噪点。',
]

export function buildProject(projectsDir, media, { projectId = 'cfh-canvas-0001', name = '画布跟手量具', videoCount = 32, imageCount = 12, textCount = 31, cols = 9 } = {}) {
  const projDir = path.join(projectsDir, `cfh-${projectId}`)
  const genDir = path.join(projDir, 'assets', 'generated')
  const impDir = path.join(projDir, 'assets', 'imported')
  for (const d of [path.join(projDir, '.nomi'), genDir, impDir]) fs.mkdirSync(d, { recursive: true })
  const { videoFile, videoMeta, imageFiles } = media
  const nodes = []
  const W = 384; const H = 404
  // 9 列网格：第 0 格是待写节点，1..32 格是视频；下面两行图、四行文本。整块约 3.8k × 3.4k 世界像素，
  // 在 1280×933 窗口（右侧 Agent 面板开着）里缩到最小缩放 0.2 正好全部在屏上。
  const CELL_W = 420; const VIDEO_ROW = 300; const IMAGE_ROW = 580; const TEXT_ROW = 260
  const cell = (index, top, rowH) => ({ x: 80 + (index % cols) * CELL_W, y: top + Math.floor(index / cols) * rowH })
  const imageTop = 80 + Math.ceil((videoCount + 1) / cols) * VIDEO_ROW
  const textTop = imageTop + Math.ceil(imageCount / cols) * IMAGE_ROW
  const aspect = videoMeta.width / videoMeta.height
  const duration = Math.round(videoMeta.durationSeconds || 15)
  for (let i = 0; i < videoCount; i++) {
    const file = `video-${String(i + 1).padStart(2, '0')}-${1787200000000 + i}.mp4`
    linkOrCopy(videoFile, path.join(genDir, file))
    const result = { id: `r-v${i + 1}`, type: 'video', url: `nomi-local://asset/${projectId}/assets/generated/${file}`, model: 'doubao-seedance-2.0', durationSeconds: duration, taskKind: 'text_to_video', createdAt: 1787200000000 + i * 1000 }
    nodes.push({
      id: `gen-v2-video-${String(i + 1).padStart(3, '0')}`, kind: 'video', title: `镜头${String(i + 1).padStart(2, '0')}`,
      position: cell(i + 1, 80, VIDEO_ROW), size: { width: W, height: H },
      prompt: `镜头${i + 1}：${TEXT_LINES[i % TEXT_LINES.length]}电影感，${duration} 秒`,
      references: [], history: [result], result, status: 'success', categoryId: 'shots', shotIndex: i + 1,
      meta: {
        modelKey: 'doubao-seedance-2.0', modelLabel: 'Seedance 2.0', modelVendor: 'apimart',
        archetype: { id: 'seedance-2-apimart', modeId: 'omni' },
        size: '16:9', resolution: '1080p', duration, generate_audio: true,
        videoWidth: videoMeta.width, videoHeight: videoMeta.height, videoAspectRatio: aspect, videoDurationSeconds: videoMeta.durationSeconds,
      },
    })
  }
  for (let j = 0; j < imageCount; j++) {
    const img = imageFiles[j % imageFiles.length]
    const ext = path.extname(img.file).toLowerCase()
    const file = `角色${String(j + 1).padStart(2, '0')}${ext}`
    linkOrCopy(img.file, path.join(impDir, file))
    const url = `nomi-local://asset/${projectId}/assets/imported/${file}`
    nodes.push({
      id: `gen-v2-asset-img-${j + 1}`, kind: 'asset', title: file,
      position: cell(j, imageTop, IMAGE_ROW), size: { width: 300, height: Math.round((300 * img.meta.height) / img.meta.width) }, prompt: '',
      references: [], history: [], status: 'success', categoryId: 'shots',
      result: { id: `r-img${j + 1}`, type: 'image', url, createdAt: 1787100000000 + j },
      meta: { source: 'asset-upload', fileName: file, imageWidth: img.meta.width, imageHeight: img.meta.height, imageAspectRatio: img.meta.width / img.meta.height },
    })
  }
  for (let k = 0; k < textCount; k++) {
    nodes.push({
      id: `gen-v2-text-${String(k + 1).padStart(3, '0')}`, kind: 'text', title: `分镜稿 ${k + 1}`,
      position: cell(k, textTop, TEXT_ROW), size: { width: 280, height: 200 },
      prompt: `写第 ${k + 1} 段分镜稿`,
      references: [], history: [], status: 'success', categoryId: 'shots',
      result: { id: `r-t${k + 1}`, type: 'text', text: `${TEXT_LINES[k % TEXT_LINES.length]}\n${TEXT_LINES[(k + 2) % TEXT_LINES.length]}`, createdAt: 1787000000000 + k },
    })
  }
  nodes.push({
    id: IDLE_NODE, kind: 'video', title: '待写镜头', position: cell(0, 80, VIDEO_ROW), size: { width: W, height: H }, prompt: '',
    references: [], history: [], status: 'idle', categoryId: 'shots', shotIndex: videoCount + 1,
    meta: {
      modelKey: 'doubao-seedance-2.0', modelLabel: 'Seedance 2.0', modelVendor: 'apimart',
      archetype: { id: 'seedance-2-apimart', modeId: 'omni' }, size: '16:9', resolution: '1080p', duration: 5, generate_audio: true,
    },
  })
  const project = {
    id: projectId, name, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
    payload: { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] }, storyboardPlan: null, storyboardPlanCommitted: false },
  }
  const body = JSON.stringify(project, null, 2)
  fs.writeFileSync(path.join(projDir, 'project.json'), body)
  fs.writeFileSync(path.join(projDir, '.nomi', 'project.json'), body)
  return { projDir, projectId, name, nodeCount: nodes.length, videoIds: nodes.filter((n) => n.kind === 'video' && n.result).map((n) => n.id) }
}

/** 已存盘项目里某节点的字段（落盘断言用；两份 project.json 取较新的那份）。 */
export function readSavedNode(projDir, nodeId) {
  const files = [path.join(projDir, 'project.json'), path.join(projDir, '.nomi', 'project.json')].filter((f) => fs.existsSync(f))
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  for (const file of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
      const canvas = doc?.payload?.generationCanvas || doc?.generationCanvas
      const node = canvas?.nodes?.find((n) => n.id === nodeId)
      if (node) return { file, mtimeMs: fs.statSync(file).mtimeMs, node }
    } catch { /* 正在写的那一刻读到半截，换另一份 */ }
  }
  return null
}

export function projectFileMtimes(projDir) {
  return [path.join(projDir, 'project.json'), path.join(projDir, '.nomi', 'project.json')]
    .map((f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0))
}
