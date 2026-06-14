// 生成画布 AI 对话的 per-project 桶交换(harness S1,治串台)。
// 外挂模块而非 store action:generationCanvasStore 是白名单巨壳(基线只减不增,R12),
// 不往里喂;用 zustand 外部 setState 实现同等语义。
// 注:messages 已迁出本桶,改由 conversationThreads 模型按项目寻址(会话历史,2026-06-14);
// 本桶只管 draft 这个「不落盘的 session 态」切项目交换。
import { createConversationBuckets } from '../../aiConversationBuckets'
import { useGenerationCanvasStore } from './generationCanvasStore'
import { clearCommittedProposal } from '../agent/proposalUndo'
import { resetClientIdRegistry } from '../agent/applyCanvasToolCall'

const generationAiBuckets = createConversationBuckets(() => ({
  generationAiDraft: '',
}))

/** 切项目:存旧项目的画布助手 draft,载入新项目的(没有则空)。messages 切空,载入由 loadProjectConversations 投影回。 */
export function swapGenerationAiProject(prevId: string | null, nextId: string | null): void {
  // S6-5 约束③:整笔撤销入口不跨项目——补偿计划引用的是旧项目节点,跨项目执行会复活幽灵。
  clearCommittedProposal()
  // 同理 clientId 注册表也不跨项目(P1):否则新项目复用旧 clientId 会解析到旧项目节点 → 误连/误删。
  resetClientIdRegistry()
  const state = useGenerationCanvasStore.getState()
  useGenerationCanvasStore.setState({
    ...generationAiBuckets.swap(prevId, nextId, {
      generationAiDraft: state.generationAiDraft,
    }),
    generationAiMessages: [],
  })
}
