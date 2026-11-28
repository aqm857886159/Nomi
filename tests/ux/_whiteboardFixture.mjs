// One fixture for every inline-whiteboard Electron journey (the production walk and the performance probe):
// an isolated project with an image node carrying a real photographed frame, plus an empty board node.
// Source image: the registered 4K library clip by default (missing library = red, no silent substitute); with
// `repoMedia` the repository's own real AI shot (640x360) is used on purpose. The mode is recorded in the report so a number is never read
// as a 4K claim when it was taken on the small frame.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'

const LIBRARY_VIDEO = 'video-4k-hevc-10bit'
const REPOSITORY_VIDEO = 'video-ai-shot-640x360'

function pngSize(file) {
  const header = fs.readFileSync(file).subarray(0, 24)
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

/**
 * `frames` distinct frames of the clip are written as photograph.png, photograph-1.png ...
 * Returns the project on disk plus the nodes; callers add their own nodes through `extraNodes(sources)`.
 */
export function buildInlineWhiteboardProject({ repoMedia = false, frames = 1, legacyAnnotations, extraNodes = () => [] } = {}) {
  const useLibrary = !repoMedia // the library clip is the default and fails loudly when the library is missing; the repository shot is an explicit choice
  const mediaId = useLibrary ? LIBRARY_VIDEO : REPOSITORY_VIDEO
  const { assets } = requireRealMediaAssets([mediaId])
  const root = makeTempDir('nomi-inline-whiteboard-')
  const projectsDir = path.join(root, 'projects')
  const projectId = 'inline-whiteboard'
  const projectRoot = path.join(projectsDir, projectId)
  const assetsDir = path.join(projectRoot, 'assets/imported')
  fs.mkdirSync(assetsDir, { recursive: true })
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  const seconds = useLibrary ? [5] : [1, 0.2, 2, 3, 4, 4.8]
  const sources = Array.from({ length: frames }, (_, index) => {
    const name = index === 0 ? 'photograph.png' : `photograph-${index}.png`
    const file = path.join(assetsDir, name)
    execFileSync(ffmpeg.path, ['-y', '-ss', String(seconds[index % seconds.length]), '-i', assets.get(mediaId).file, '-frames:v', '1', file], { stdio: 'pipe' })
    const result = { id: index === 0 ? 'original' : `frame-${index}`, type: 'image', url: `nomi-local://asset/${projectId}/assets/imported/${name}`, createdAt: 1 }
    return { file, result }
  })
  const imagePath = sources[0].file
  const size = pngSize(imagePath)
  const firstResult = sources[0].result
  const nodes = [
    { id: 'image', kind: 'image', categoryId: 'shots', title: 'Photograph', prompt: '', position: { x: 200, y: 140 }, size: { width: 600, height: 337.5 }, status: 'success', result: firstResult, history: [firstResult],
      meta: { imageWidth: size.width, imageHeight: size.height, previewHeight: 337.5, userResized: true, ...(legacyAnnotations ? { whiteboardAnnotations: legacyAnnotations } : {}) } },
    { id: 'board', kind: 'whiteboard', categoryId: 'shots', title: 'Board', prompt: '', position: { x: 1050, y: 160 }, size: { width: 420, height: 236 }, status: 'idle' },
    ...extraNodes({ sources, size }),
  ]
  const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [], groups: [], selectedNodeIds: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } }, storyboardPlan: null, storyboardPlanCommitted: false }
  const record = { id: projectId, name: 'Inline whiteboard verification', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
  const recordPath = path.join(projectRoot, '.nomi/project.json')
  for (const name of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, name), JSON.stringify(record))
  const readNode = (id) => JSON.parse(fs.readFileSync(recordPath, 'utf8')).payload.generationCanvas.nodes.find((node) => node.id === id)
  return { root, projectsDir, projectId, record, recordPath, imagePath, nodes, sources, readNode, source: { mode: useLibrary ? 'library-4k' : 'repository-shot', mediaId, width: size.width, height: size.height, uniqueImages: frames } }
}
