// per-project AI 对话落盘胶水(harness S1b-3,拍板 P-3)。
// 读:hydrate 后种回两面板(仅当内存桶为空——内存是本会话真相,磁盘只是工作记录)。
// 写:消息变化防抖 1s 回写;**切项目前必须先 flushNow(旧 id)**——否则防抖窗口里
// 挂着的回写会在交换后把新项目的内容写进旧项目文件(时序坑,此处结构性封死)。
import { getDesktopBridge, type PersistedAiMessage } from '../../desktop/bridge'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { WorkbenchAiMessage } from './workbenchAiTypes'

const WRITE_DEBOUNCE_MS = 1000

const toPersisted = (messages: readonly WorkbenchAiMessage[]): PersistedAiMessage[] =>
  messages.map((message) => ({ id: message.id, role: message.role, content: message.content }))

function writeNow(projectId: string): void {
  const api = getDesktopBridge()?.conversations
  if (!api || !projectId) return
  void api
    .write(projectId, {
      creationMessages: toPersisted(useWorkbenchStore.getState().creationAiMessages),
      generationMessages: toPersisted(useGenerationCanvasStore.getState().generationAiMessages),
    })
    .catch(() => {})
}

let timer: ReturnType<typeof setTimeout> | null = null

/** 消息变化后的防抖回写;projectId 在冲刷时刻取(防切换期错绑)。 */
export function scheduleConversationsWrite(getProjectId: () => string | null): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const projectId = getProjectId()
    if (projectId) writeNow(projectId)
  }, WRITE_DEBOUNCE_MS)
}

/** 切项目前调用:取消挂起的防抖,立即把"当前 store 内容"写给明确指定的旧项目。 */
export function flushConversationsNow(projectId: string | null): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (projectId) writeNow(projectId)
}

/** hydrate 后把磁盘上的工作记录种回面板(仅当内存桶为空)。 */
export async function loadProjectConversations(projectId: string): Promise<void> {
  const api = getDesktopBridge()?.conversations
  if (!api) return
  try {
    const { ok, conversations } = await api.read(projectId)
    if (!ok || !conversations) return
    const workbench = useWorkbenchStore.getState()
    if (workbench.creationAiMessages.length === 0 && conversations.creationMessages.length > 0) {
      workbench.setCreationAiMessages(conversations.creationMessages as WorkbenchAiMessage[])
    }
    const canvas = useGenerationCanvasStore.getState()
    if (canvas.generationAiMessages.length === 0 && conversations.generationMessages.length > 0) {
      canvas.setGenerationAiMessages(conversations.generationMessages as WorkbenchAiMessage[])
    }
  } catch {
    /* 旁路:读失败不影响面板 */
  }
}

/** 订阅两面板消息变化 → 防抖回写。返回解除函数。 */
export function initConversationPersistence(getProjectId: () => string | null): () => void {
  const onChange = () => scheduleConversationsWrite(getProjectId)
  const unsubscribeWorkbench = useWorkbenchStore.subscribe((state) => state.creationAiMessages, onChange)
  const unsubscribeCanvas = useGenerationCanvasStore.subscribe((state) => state.generationAiMessages, onChange)
  return () => {
    unsubscribeWorkbench()
    unsubscribeCanvas()
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
}
