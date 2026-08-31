// ComfyUI 工作流绑定的**共享纯逻辑**（角色指派 / 画布字段暴露 / 候选推导），零 React、可单测。
// plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
//
// 为什么单独成文件：这套规则原来只活在 ComfyuiWorkflowImportPanel.tsx 里（贴 JSON 导入那条路）。
// 工作流整页把「编辑」接过去之后，两条路都要用同一份规则——抄第二份就是并行版（P1），
// 且第一次漂移必然重演 2026-08-03/08-11 那个「提示词被参数占位覆盖、静默失效」的 bug。
//
// 与 electron/catalog/comfyuiWorkflowImport.ts 的 roleBoundInputKeys 同源同义：
// 这里管「别摆出来 + 指派时就地清干净」（体验），那里管「摆出来了也不许生效」（correctness 兜底）。
import { paramCandidates, type RoleBinding } from './comfyuiParamCandidates'

/** 会占用节点输入的四个角色 + 成品节点（成品不占输入，只认节点）。 */
export type WorkflowRole = 'prompt' | 'firstFrame' | 'lastFrame' | 'sourceVideo' | 'output'

export type WorkflowParamType = 'number' | 'text' | 'boolean'
export type WorkflowParam = {
  nodeId: string
  inputKey: string
  paramKey: string
  label: string
  type: WorkflowParamType
  default: string | number | boolean
}
export type NumericParam = { nodeId: string; inputKey: string; paramKey: string; label: string; default: number }

/** ⚠️ electron/catalog/comfyuiWorkflowImport.ts 里 WorkflowBinding 的**渲染层镜像**（IPC 两侧各一份，
 *  改一侧必须同步另一侧——3D 产物那次就是只改了后端，这里的 outputKind 还停在 image|video）。 */
export type WorkflowBinding = {
  promptNodeId?: string; promptInputKey?: string
  firstFrameNodeId?: string; firstFrameInputKey?: string
  lastFrameNodeId?: string; lastFrameInputKey?: string
  sourceVideoNodeId?: string; sourceVideoInputKey?: string
  outputNodeId?: string; outputKind?: 'image' | 'video' | 'model3d'
  numeric?: NumericParam[]
  params?: WorkflowParam[]
}

export type WorkflowCandidate = {
  nodeId: string
  inputKey: string
  classType: string
  title?: string
  value: string | number | boolean
  /** 媒体输入才有：收图还是收视频（LoadVideo.file 收视频）。 */
  mediaKind?: 'image' | 'video'
}
export type WorkflowOutputCandidate = { nodeId: string; classType: string; kind: 'image' | 'video' }

export type WorkflowAnalysis = {
  textInputs: WorkflowCandidate[]
  imageInputs: WorkflowCandidate[]
  outputNodes: WorkflowOutputCandidate[]
  numericInputs: WorkflowCandidate[]
  widgetInputs?: WorkflowCandidate[]
  suggested: WorkflowBinding
}

const PARAM_KEY_RE = /^[A-Za-z0-9_]+$/

/** 老快照只有 numeric（全是数值参数）→ 补齐成统一的 params，之后全链只面对一种形态（不留两套）。 */
export function normalizeBinding(binding: WorkflowBinding): WorkflowBinding {
  return {
    ...binding,
    numeric: binding.numeric ?? [],
    params: binding.params ?? (binding.numeric ?? []).map((n) => ({ ...n, type: 'number' as const })),
  }
}

export function inferParamType(value: WorkflowCandidate['value']): WorkflowParamType {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'text'
}

export function sanitizeParamKey(raw: string, fallback: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || fallback
}

export function fallbackParamLabel(candidate: Pick<WorkflowCandidate, 'title' | 'inputKey' | 'nodeId'>): string {
  return candidate.title?.trim() || `${candidate.inputKey} #${candidate.nodeId}`
}

/**
 * 派生 paramKey 一律加 `comfy_` 前缀 —— **这是防静默失效的硬约束，别为了 key 好看去掉。**
 *
 * 根因：主进程 taskTemplateParams（electron/catalog/taskParams.ts）拼模板取值表时是
 *   `{ ...extras, width: request.width, height: request.height, seed, steps, cfgScale, ... }`
 * ——一批保留名**排在 extras 之后**。于是一个叫 `width` 的工作流参数会被 `request.width`
 * （画布不填就是 undefined）当场覆盖掉，`{{request.params.width}}` 渲染成空、整个 input 键被丢弃，
 * ComfyUI 收到的图里那个值凭空消失。界面上一切正常，只有出图尺寸不对——正是最难查的那类。
 * 走查实锤：一个 _meta.title 为 "WIDTH" 的 INTConstant，派生出 key `width`，提交的图里 inputs 变成 {}。
 *
 * 既有的 PARAM_PRESETS 本来就写死 `comfy_width`/`comfy_height`/... 躲开了这一层，
 * 只有自由添加的参数没躲——两条路口径不一致才是真问题。统一到「都带前缀」。
 * 保留名没有一个以 `comfy_` 开头，故前缀即结构性保证，不用维护一张追不完的保留字清单。
 */
const PARAM_KEY_PREFIX = 'comfy_'

/** 候选 → 参数行（paramKey 去重加后缀；label 用作者的节点标题优先）。 */
export function paramFromCandidate(candidate: WorkflowCandidate, existing: WorkflowParam[] = []): WorkflowParam {
  const label = fallbackParamLabel(candidate)
  const derived = sanitizeParamKey(label.toLowerCase(), candidate.inputKey)
  const baseKey = derived.startsWith(PARAM_KEY_PREFIX) ? derived : `${PARAM_KEY_PREFIX}${derived}`
  let paramKey = baseKey
  let i = 2
  while (existing.some((p) => p.paramKey === paramKey)) {
    paramKey = `${baseKey}_${i}`
    i += 1
  }
  return {
    nodeId: candidate.nodeId,
    inputKey: candidate.inputKey,
    paramKey,
    label,
    type: inferParamType(candidate.value),
    default: candidate.value,
  }
}

/** 参数 key 合法性（空/非法字符/重名）。返回出错的那一类，调用方翻成文案。 */
export function paramKeyProblem(params: readonly WorkflowParam[]): 'invalid' | 'duplicate' | null {
  const seen = new Set<string>()
  for (const param of params) {
    if (!param.paramKey.trim() || !PARAM_KEY_RE.test(param.paramKey)) return 'invalid'
    if (seen.has(param.paramKey)) return 'duplicate'
    seen.add(param.paramKey)
  }
  return null
}

/** 全部标量 widget 候选（新版分析给 widgetInputs，老版只有 numericInputs）。 */
export function allWidgetInputs(analysis: WorkflowAnalysis | null): WorkflowCandidate[] {
  if (!analysis) return []
  return analysis.widgetInputs?.length ? analysis.widgetInputs : analysis.numericInputs
}

/**
 * 指派角色。**必须同时把绑到同一个输入的参数行撤掉**——一个输入只能有一个身份，
 * 否则导入时参数占位会覆盖角色占位（用户打的提示词静默送不进 ComfyUI）。留着那行等于骗他配了个不生效的参数。
 */
export function assignRole(
  binding: WorkflowBinding,
  role: WorkflowRole,
  target: { nodeId: string; inputKey?: string; outputKind?: 'image' | 'video' | 'model3d' },
): WorkflowBinding {
  const { nodeId, inputKey } = target
  if (role === 'output') return { ...binding, outputNodeId: nodeId, outputKind: target.outputKind ?? binding.outputKind }
  if (!inputKey) return binding
  const params = (binding.params ?? []).filter((p) => !(p.nodeId === nodeId && p.inputKey === inputKey))
  const next: WorkflowBinding = { ...binding, params }
  if (role === 'prompt') return { ...next, promptNodeId: nodeId, promptInputKey: inputKey }
  if (role === 'firstFrame') return { ...next, firstFrameNodeId: nodeId, firstFrameInputKey: inputKey }
  if (role === 'lastFrame') return { ...next, lastFrameNodeId: nodeId, lastFrameInputKey: inputKey }
  return { ...next, sourceVideoNodeId: nodeId, sourceVideoInputKey: inputKey }
}

/** 清掉某个角色（成品不可清空——没有成品节点就取不回结果，UI 也不给这个选项）。 */
export function clearRole(binding: WorkflowBinding, role: Exclude<WorkflowRole, 'output'>): WorkflowBinding {
  if (role === 'prompt') return { ...binding, promptNodeId: undefined, promptInputKey: undefined }
  if (role === 'firstFrame') return { ...binding, firstFrameNodeId: undefined, firstFrameInputKey: undefined }
  if (role === 'lastFrame') return { ...binding, lastFrameNodeId: undefined, lastFrameInputKey: undefined }
  return { ...binding, sourceVideoNodeId: undefined, sourceVideoInputKey: undefined }
}

export function currentRoleOf(binding: WorkflowBinding, nodeId: string): WorkflowRole | null {
  if (binding.promptNodeId === nodeId) return 'prompt'
  if (binding.firstFrameNodeId === nodeId) return 'firstFrame'
  if (binding.lastFrameNodeId === nodeId) return 'lastFrame'
  if (binding.sourceVideoNodeId === nodeId) return 'sourceVideo'
  if (binding.outputNodeId === nodeId) return 'output'
  return null
}

export type RoleChoice = {
  role: WorkflowRole
  inputKey?: string
  /** 这个输入当前**已经**担着这个角色（菜单里打勾 + 再点=取消）。 */
  active: boolean
  outputKind?: 'image' | 'video' | 'model3d'
}

/**
 * 这个节点能担哪些角色 —— 由分析给的候选推导，**不猜**。
 * 一个节点可能有多个同类输入（两个 CLIPTextEncode 的 text、SDXL 的 text_g/text_l），
 * 故按 (role, inputKey) 逐个列，菜单上带 inputKey 区分；只有一个时 UI 不显 inputKey（不制造噪音）。
 */
export function roleChoicesForNode(
  analysis: WorkflowAnalysis | null,
  binding: WorkflowBinding,
  nodeId: string,
): RoleChoice[] {
  if (!analysis) return []
  const choices: RoleChoice[] = []
  for (const candidate of analysis.textInputs) {
    if (candidate.nodeId !== nodeId) continue
    choices.push({
      role: 'prompt',
      inputKey: candidate.inputKey,
      active: binding.promptNodeId === nodeId && binding.promptInputKey === candidate.inputKey,
    })
  }
  for (const candidate of analysis.imageInputs) {
    if (candidate.nodeId !== nodeId) continue
    if (candidate.mediaKind === 'video') {
      // LoadVideo.file 收的是**视频**，和首帧图不是一回事（当首帧发 = 把 mp4 当图传，必失败）。
      choices.push({
        role: 'sourceVideo',
        inputKey: candidate.inputKey,
        active: binding.sourceVideoNodeId === nodeId && binding.sourceVideoInputKey === candidate.inputKey,
      })
      continue
    }
    choices.push({
      role: 'firstFrame',
      inputKey: candidate.inputKey,
      active: binding.firstFrameNodeId === nodeId && binding.firstFrameInputKey === candidate.inputKey,
    })
    choices.push({
      role: 'lastFrame',
      inputKey: candidate.inputKey,
      active: binding.lastFrameNodeId === nodeId && binding.lastFrameInputKey === candidate.inputKey,
    })
  }
  const output = analysis.outputNodes.find((o) => o.nodeId === nodeId)
  if (output) {
    choices.push({ role: 'output', active: binding.outputNodeId === nodeId, outputKind: output.kind })
  }
  return choices
}

export type FieldChoice = {
  candidate: WorkflowCandidate
  /** 已经是画布上的可调字段（菜单里打勾 + 再点=撤掉）。 */
  exposed: boolean
}

/**
 * 这个节点有哪些输入能变成「画布上的可调字段」。
 * 候选池按**当前** binding 现算（paramCandidates 已排掉被角色占用的输入）——用户改了提示词节点，
 * 新选中的立刻从候选消失、旧的立刻回来。钉死在 analysis.suggested 上正是那个反复被报的 bug。
 */
export function fieldChoicesForNode(
  analysis: WorkflowAnalysis | null,
  binding: WorkflowBinding,
  nodeId: string,
): FieldChoice[] {
  const pool = paramCandidates(allWidgetInputs(analysis), binding as RoleBinding)
  const params = binding.params ?? []
  return pool
    .filter((c) => c.nodeId === nodeId)
    .map((candidate) => ({
      candidate,
      exposed: params.some((p) => p.nodeId === candidate.nodeId && p.inputKey === candidate.inputKey),
    }))
}

/** 暴露/撤销一个画布字段（撤销按 nodeId+inputKey 精确定位，不按 paramKey——后者用户可改）。 */
export function toggleField(binding: WorkflowBinding, candidate: WorkflowCandidate): WorkflowBinding {
  const params = binding.params ?? []
  const exists = params.some((p) => p.nodeId === candidate.nodeId && p.inputKey === candidate.inputKey)
  if (exists) {
    return { ...binding, params: params.filter((p) => !(p.nodeId === candidate.nodeId && p.inputKey === candidate.inputKey)) }
  }
  return { ...binding, params: [...params, paramFromCandidate(candidate, params)] }
}
