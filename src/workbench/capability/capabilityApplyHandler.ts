import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { getActiveWorkbenchProjectId } from '../project/workbenchProjectSession'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import { getDesktopBridge } from '../../desktop/bridge'

// 能力核 A 模式实时桥 · 渲染层处理器。
// 主进程把外部 MCP 的画布读/写/付费确认转发到这里（只在该项目正打开时路由），处理后回结果。
// 单一真相源：画布读写复用 store 现成动作（readDocumentSnapshot / applyExternalGraph），
// 付费确认复用全仓唯一的 useSpendConfirmStore（不另造并行 UI，P1）。

type SpendConfirmPayload = {
  projectId?: string
  projectName?: string
  nodeId?: string
  intent?: string
  vendor?: string
  modelKey?: string
  prompt?: string
}

const INTENT_LABEL: Record<string, string> = {
  image: '一张画面',
  video: '一段视频',
  audio: '一段音频',
  text: '一段文本',
}

function describeIntent(intent: string | undefined): string {
  return INTENT_LABEL[String(intent || '')] || '一个素材'
}

/** 外部 MCP 付费确认：弹全仓唯一的确认对话框（agent 来源 + 明细 + 60s 倒计时），真人点了才回 confirmed。 */
async function confirmSpendForAgent(info: SpendConfirmPayload): Promise<{ confirmed: boolean }> {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((item) => item.id === info.nodeId)
  const nodeLabel = node?.title?.trim() || (typeof node?.prompt === 'string' && node.prompt.trim() ? node.prompt.trim().slice(0, 24) : '新节点')
  const promptPreview = typeof info.prompt === 'string' && info.prompt.trim() ? info.prompt.trim().slice(0, 60) : ''
  const projectName = typeof info.projectName === 'string' ? info.projectName.trim() : ''
  const ok = await useSpendConfirmStore.getState().requestConfirm({
    title: `AI 助手想生成${describeIntent(info.intent)}`,
    message: promptPreview ? `提示词：「${promptPreview}${info.prompt && info.prompt.length > 60 ? '…' : ''}」。确认后将消耗模型额度生成。` : '确认后将消耗模型额度生成。',
    confirmLabel: '确认生成',
    source: 'agent',
    countdownMs: 60_000,
    details: [
      // 项目行放第一位：用户可能不在这个项目里，先让他知道花在哪个项目。
      ...(projectName ? [{ label: '项目', value: projectName }] : []),
      { label: '节点', value: nodeLabel },
      { label: '模型', value: [info.vendor, info.modelKey].filter(Boolean).join(' · ') || '默认模型' },
      { label: '产物', value: describeIntent(info.intent) },
    ],
  })
  return { confirmed: Boolean(ok) }
}

/** 处理一条主进程转发来的能力操作。未知操作抛错（主进程会把错误透传给 agent）。 */
export async function handleCapabilityApply(op: string, payload: unknown): Promise<unknown> {
  const data = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const projectId = typeof data.projectId === 'string' ? data.projectId : ''
  const activeId = getActiveWorkbenchProjectId()
  // 画布读写**只能**作用于当前打开的项目（动 store → 必须是活动项目，否则串台）；目标≠活动 → 拒。
  // 付费确认（spend.confirm）不在此限：用户拍板 A——AI 想在「非当前项目」生成时也弹全局卡，
  // 卡里标明项目名，确认后走盘落地（不动非活动 store）。这正是治静默黑洞的关键放开。
  if (op !== 'spend.confirm' && projectId && activeId && projectId !== activeId) {
    throw new Error('项目已切换，无法实时应用')
  }

  switch (op) {
    case 'canvas.read-doc':
      return useGenerationCanvasStore.getState().readDocumentSnapshot()
    case 'canvas.apply':
      useGenerationCanvasStore.getState().applyExternalGraph(data.snapshot)
      return { ok: true }
    case 'spend.confirm':
      return confirmSpendForAgent(data as SpendConfirmPayload)
    default:
      throw new Error(`未知 capability 操作: ${op}`)
  }
}

let unregister: (() => void) | null = null

/** 在 app 启动时注册一次（NomiStudioApp）。重复注册先反注册旧的。preload 无 onApply（老版本）则 no-op。 */
export function registerCapabilityApplyHandler(): void {
  unregister?.()
  unregister = null
  const onApply = getDesktopBridge()?.capability?.onApply
  if (typeof onApply === 'function') {
    unregister = onApply(handleCapabilityApply)
  }
}
