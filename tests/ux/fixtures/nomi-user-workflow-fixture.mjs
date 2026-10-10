import fs from 'node:fs'
import path from 'node:path'
import { CANVAS_PERF_SCALES, createCanvasPerformanceFixture } from './canvas-performance-fixture.mjs'

export const NOMI_WORKFLOW_SCALES = Object.freeze({
  small: Object.freeze({ canvasScale: 'REAL', documents: 2, plans: 2, shotsPerPlan: 12, images: 4, videos: 2 }),
  typical: Object.freeze({ canvasScale: 'S', documents: 5, plans: 5, shotsPerPlan: 48, images: 24, videos: 24 }),
  heavy: Object.freeze({ canvasScale: 'XL', documents: 12, plans: 10, shotsPerPlan: 320, images: 160, videos: 160 }),
})

const EMPTY_DOC = Object.freeze({ type: 'doc', content: [{ type: 'paragraph' }] })

const clone = (value) => JSON.parse(JSON.stringify(value))

function distributePlans(documentCount, planCount) {
  const result = Array.from({ length: documentCount }, () => 0)
  for (let index = 0; index < planCount; index += 1) result[index % documentCount] += 1
  return result
}

function shot(index, scale, planIndex) {
  return {
    index: index + 1,
    shotId: `workflow-${scale}-plan-${planIndex}-shot-${index + 1}`,
    shotKind: index % 3 === 0 ? 'image' : 'video',
    durationSec: 5,
    anchorIds: [],
    prompt: `Workflow fixture shot ${index + 1}`,
    modelKey: 'local-fixture-model',
    modeId: 'fixture',
  }
}

function buildPlan(scale, planIndex, shotCount) {
  return {
    title: `Workflow plan ${planIndex + 1}`,
    profileKey: 'fixture.performance',
    anchors: [],
    shots: Array.from({ length: shotCount }, (_, index) => shot(index, scale, planIndex)),
  }
}

function ensureTwoVideos(record, projectId) {
  // REAL is intentionally the small, real-media profile (4 images + 1 video).
  // Add one deterministic copy so the user matrix's small tier remains 4 + 2.
  const canvas = record.payload?.generationCanvas
  const source = canvas?.nodes?.find((node) => node.kind === 'video')
  if (!source) return
  const copy = clone(source)
  copy.id = `${source.id}-workflow-video-2`
  copy.title = 'Workflow video 2'
  copy.result = { ...copy.result, id: `${copy.id}-result` }
  copy.position = { x: (copy.position?.x ?? 80) + 390, y: (copy.position?.y ?? 80) + 300 }
  canvas.nodes.push(copy)
  canvas.edges = Array.isArray(canvas.edges) ? canvas.edges : []
  canvas.edges.push({ id: `${projectId}-workflow-edge-video-2`, source: source.id, target: copy.id, mode: 'reference', order: 0 })
}

export function validateWorkflowFixtureSummary(summary, scale) {
  const expected = NOMI_WORKFLOW_SCALES[scale]
  if (!expected) throw new Error(`unknown workflow scale: ${scale}`)
  for (const key of ['documents', 'plans', 'shots', 'images', 'videos']) {
    const expectedValue = key === 'shots' ? expected.plans * expected.shotsPerPlan : expected[key]
    if (summary[key] !== expectedValue) {
      throw new Error(`${scale} ${key} expected ${expectedValue} but received ${summary[key]}`)
    }
  }
  if (summary.mediaProfile !== 'synthetic-preview' && summary.mediaProfile !== 'real-assets') {
    throw new Error(`unexpected media profile: ${summary.mediaProfile}`)
  }
  return true
}

/**
 * Build a complete, offline project fixture for the user workflow matrix.
 * Agent states are deliberately not persisted here: the runner labels its local
 * timer/loopback state separately so no paid provider can be reached by this fixture.
 */
export function createNomiUserWorkflowFixture({ projectsDir, scale = 'typical', projectId } = {}) {
  const config = NOMI_WORKFLOW_SCALES[scale]
  if (!config) throw new Error(`unknown workflow scale '${scale}'`)
  if (!projectsDir) throw new Error('projectsDir is required')
  const id = projectId || `project-nomi-user-workflow-${scale}`
  if (!CANVAS_PERF_SCALES[config.canvasScale]) throw new Error(`unknown canvas scale '${config.canvasScale}'`)
  const base = createCanvasPerformanceFixture({
    projectsDir,
    scale: config.canvasScale,
    projectId: id,
    projectName: `ZZ Nomi user workflow ${scale}`,
  })
  const record = clone(base.record)
  if (scale === 'small') ensureTwoVideos(record, id)

  const planDistribution = distributePlans(config.documents, config.plans)
  const documents = []
  const designsByDocument = {}
  const plansByDocument = {}
  for (let documentIndex = 0; documentIndex < config.documents; documentIndex += 1) {
    const documentId = `workflow-${scale}-document-${documentIndex + 1}`
    documents.push({
      id: documentId,
      version: 1,
      title: `Workflow document ${documentIndex + 1}`,
      updatedAt: 100 + documentIndex,
      contentJson: clone(EMPTY_DOC),
    })
    const designs = []
    const persistedPlans = []
    for (let localPlan = 0; localPlan < planDistribution[documentIndex]; localPlan += 1) {
      const planIndex = designs.length + documentIndex
      const plan = buildPlan(scale, planIndex, config.shotsPerPlan)
      const designId = `workflow-${scale}-design-${documentIndex + 1}-${localPlan + 1}`
      const design = {
        id: designId,
        documentId,
        title: plan.title,
        plan,
        committed: false,
        status: 'draft',
        sourceDocumentUpdatedAt: 100 + documentIndex,
        createdAt: 101 + planIndex,
        updatedAt: 101 + planIndex,
      }
      designs.push(design)
      persistedPlans.push({ plan, committed: false })
    }
    designsByDocument[documentId] = designs
    plansByDocument[documentId] = persistedPlans
  }
  record.payload = {
    ...record.payload,
    workbenchDocuments: documents,
    activeDocumentId: documents[0]?.id,
    storyboardDesignsByDocumentId: designsByDocument,
    storyboardPlans: plansByDocument,
  }
  record.lastKnownRootPath = base.projectRoot
  for (const filename of [path.join(base.projectRoot, 'project.json'), path.join(base.projectRoot, '.nomi', 'project.json')]) {
    fs.writeFileSync(filename, JSON.stringify(record, null, 1))
  }
  const summary = {
    scale,
    documents: documents.length,
    plans: config.plans,
    shots: config.plans * config.shotsPerPlan,
    images: config.images,
    videos: config.videos,
    mediaProfile: base.summary.mediaProfile,
    canvasScale: config.canvasScale,
    canvasNodes: record.payload.generationCanvas?.nodes?.length || 0,
    canvasEdges: record.payload.generationCanvas?.edges?.length || 0,
  }
  validateWorkflowFixtureSummary(summary, scale)
  return { ...base, record, summary }
}
