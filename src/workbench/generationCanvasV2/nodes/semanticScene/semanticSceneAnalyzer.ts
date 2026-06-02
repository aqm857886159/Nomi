import { listWorkbenchModelCatalogModels, type ModelCatalogModelDto } from '../../../api/modelCatalogApi'
import { runWorkbenchTaskByVendor, type TaskResultDto } from '../../../api/taskApi'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { normalizeSemanticScene } from './semanticSceneSerializer'
import type { SemanticScene } from './semanticSceneTypes'

type AnalyzeSemanticSceneInput = {
  node: GenerationCanvasNode
  scene: SemanticScene
  draftJson?: string
}

type SelectedSemanticSceneModel = {
  vendor: string
  modelKey: string
  modelAlias: string
  label: string
}

type JsonRecord = Record<string, unknown>

const VISION_MODEL_HINTS = [
  'gemini',
  'gpt-4o',
  'gpt-5',
  'vision',
  'vl',
  'qwen',
  'claude',
  'pixtral',
]

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function extractTextFromRaw(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const raw = value as JsonRecord
  const direct = [
    raw.text,
    raw.output,
    raw.result,
    raw.content,
    raw.response,
    asRecord(raw.data).text,
    asRecord(raw.data).output,
  ]
  for (const item of direct) {
    const text = stringValue(item)
    if (text) return text
  }
  const choices = Array.isArray(raw.choices) ? raw.choices : []
  for (const choice of choices) {
    const record = asRecord(choice)
    const message = asRecord(record.message)
    const text = stringValue(message.content) || stringValue(record.text)
    if (text) return text
  }
  return ''
}

function extractJsonText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed
}

function compactDraftJson(value: string | undefined): string {
  const text = value?.trim()
  if (!text) return ''
  try {
    const parsed = asRecord(JSON.parse(text))
    const sourceImageUrls = Array.isArray(parsed.sourceImageUrls) ? parsed.sourceImageUrls : []
    const compact = {
      ...parsed,
      ...(sourceImageUrls.length ? { sourceImageUrls: [`<${sourceImageUrls.length} source image url omitted>`] } : {}),
    }
    return JSON.stringify(compact, null, 2)
  } catch {
    return text.length > 8000 ? `${text.slice(0, 8000)}\n<draft truncated>` : text
  }
}

function modelScore(model: ModelCatalogModelDto): number {
  const text = [
    model.modelKey,
    model.modelAlias || '',
    model.labelZh || '',
  ].join(' ').toLowerCase()
  const hintScore = VISION_MODEL_HINTS.reduce((score, hint) => score + (text.includes(hint) ? 12 : 0), 0)
  const proScore = text.includes('pro') ? 4 : 0
  const flashScore = text.includes('flash') ? 2 : 0
  return hintScore + proScore + flashScore
}

async function selectSemanticSceneModel(node: GenerationCanvasNode): Promise<SelectedSemanticSceneModel> {
  const meta = node.meta || {}
  const metaVendor = stringValue(meta.modelVendor) || stringValue(meta.vendor)
  const metaModel = stringValue(meta.modelKey) || stringValue(meta.modelAlias)
  if (metaVendor && metaModel) {
    return {
      vendor: metaVendor,
      modelKey: metaModel,
      modelAlias: metaModel,
      label: metaModel,
    }
  }

  const models = await listWorkbenchModelCatalogModels({ kind: 'text', enabled: true })
  if (!models.length) throw new Error('没有可用的文本/视觉理解模型，请先在模型管理中配置一个支持图片理解的模型。')
  const sorted = [...models].sort((a, b) => modelScore(b) - modelScore(a))
  const selected = sorted[0]
  return {
    vendor: selected.vendorKey,
    modelKey: selected.modelKey,
    modelAlias: selected.modelAlias || selected.modelKey,
    label: selected.labelZh || selected.modelAlias || selected.modelKey,
  }
}

function buildSemanticScenePrompt(input: AnalyzeSemanticSceneInput): string {
  const sourceType = input.scene.sourceType
  const sourceCount = input.scene.sourceImageUrls.length
  const currentDraft = compactDraftJson(input.draftJson)
  return [
    '你是建筑与开放环境的视觉语义解析器。请根据输入图像输出可用于搭建 3D 场景的语义场景图 JSON。',
    '',
    '重要规则：',
    '- 只输出一个 JSON 对象，不要 Markdown，不要解释。',
    '- 如果是室内建筑，优先识别房间 polygon、墙、门、窗、地面、天花、家具、灯光、相机。',
    '- 如果是开放场景，不要强行创建房间；使用 outdoor_open 或 mixed，并识别 terrain、plaza、path、facade、vegetation、building、landform、vehicle、person。',
    '- 看不见或不确定的内容写入 graph.uncertainties，不要编造成精确事实。',
    '- 没有可靠尺度时 coordinateSystem 使用 relative；有比例线索时才使用 meters_estimated。',
    '- 2D 坐标为 [x,z]，3D 坐标为 [x,y,z]。以图片中心附近为原点，估计一个便于搭建的相对坐标系。',
    '- color 必须是 #rrggbb。',
    '',
    '必须符合这个结构：',
    JSON.stringify({
      version: '1.0',
      sourceType,
      sceneClass: 'indoor_architecture|outdoor_open|mixed|unknown',
      confidence: 0.75,
      coordinateSystem: 'relative|meters_estimated',
      sourceImageUrls: [],
      scaleHint: '',
      graph: {
        spaces: [{ id: 'space-1', name: '主空间', type: 'room|area|path|plaza|terrain|unknown', floorPolygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]], approximateSize: [4, 4], confidence: 0.7 }],
        boundaries: [{ id: 'boundary-1', name: '后墙', kind: 'wall|facade|fence|edge|terrain_edge|unknown', start: [-2, -2], end: [2, -2], height: 2.8, thickness: 0.16, material: 'paint', color: '#d8d4cb', confidence: 0.7 }],
        openings: [{ id: 'opening-1', name: '窗', kind: 'door|window|archway|unknown', boundaryId: 'boundary-1', position: [0, -2], width: 1.2, height: 1, sillHeight: 0.9, confidence: 0.6 }],
        surfaces: [{ id: 'surface-1', name: '地面', kind: 'floor|ceiling|wall|ground|sky|water|unknown', material: 'wood', color: '#7f756a', confidence: 0.7 }],
        objects: [{ id: 'object-1', name: '沙发', kind: 'furniture|prop|vegetation|vehicle|person|light|building|landform|unknown', position: [0, 0.4, 0], size: [2, 0.8, 0.9], rotationY: 0, material: 'fabric', color: '#7c8ea0', confidence: 0.7 }],
        lighting: { timeOfDay: 'day', mood: 'soft daylight', mainDirection: 'front-left', softness: 'soft', color: '#ffffff' },
        cameras: [{ id: 'camera-1', name: '主相机', position: [3, 2.2, 4], target: [0, 0.8, 0], fov: 45, aspectRatio: '16:9' }],
        uncertainties: ['尺度为估计值'],
      },
    }, null, 2),
    '',
    `源类型：${sourceType}`,
    `源图数量：${sourceCount}`,
    input.scene.scaleHint ? `比例尺提示：${input.scene.scaleHint}` : '',
    currentDraft ? `当前已有草稿 JSON，允许保留人工字段并补全：\n${currentDraft}` : '',
  ].filter(Boolean).join('\n')
}

function parseSemanticSceneResponse(result: TaskResultDto, fallback: SemanticScene): SemanticScene {
  const text = extractTextFromRaw(result.raw)
  if (!text) throw new Error('模型没有返回可解析文本。')
  const jsonText = extractJsonText(text)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('模型返回的内容不是合法 JSON。')
  }
  const normalized = normalizeSemanticScene({
    ...asRecord(parsed),
    sourceType: asRecord(parsed).sourceType || fallback.sourceType,
    sourceNodeId: asRecord(parsed).sourceNodeId || fallback.sourceNodeId,
    sourceImageUrls: fallback.sourceImageUrls.length ? fallback.sourceImageUrls : asRecord(parsed).sourceImageUrls,
    scaleHint: asRecord(parsed).scaleHint || fallback.scaleHint,
    createdAt: fallback.createdAt,
    updatedAt: Date.now(),
  })
  return normalized
}

export async function analyzeSemanticSceneFromSource(input: AnalyzeSemanticSceneInput): Promise<{
  scene: SemanticScene
  model: SelectedSemanticSceneModel
  raw: unknown
}> {
  const imageUrl = input.scene.sourceImageUrls[0]
  if (!imageUrl) throw new Error('语义场景节点没有绑定源图。请从全景图节点创建，或在 JSON 中填写 sourceImageUrls。')
  const model = await selectSemanticSceneModel(input.node)
  const result = await runWorkbenchTaskByVendor(model.vendor, {
    kind: 'image_to_prompt',
    prompt: buildSemanticScenePrompt(input),
    extras: {
      modelKey: model.modelKey,
      modelAlias: model.modelAlias,
      imageUrl,
      image_url: imageUrl,
      referenceImages: input.scene.sourceImageUrls,
      maxTokens: 4096,
      temperature: 0.2,
      nodeId: input.node.id,
      nodeKind: input.node.kind,
    },
  })
  if (result.status === 'failed') throw new Error('语义场景分析失败')
  return {
    scene: parseSemanticSceneResponse(result, input.scene),
    model,
    raw: result.raw,
  }
}
