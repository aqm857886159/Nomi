import type { ComposerAttachment } from './composer/composerAttachmentTypes'

export type WorkbenchAiMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** assistant 消息生命周期状态。undefined 兼容旧 session 消息，视为 done。
   *  pending   = 已发送、等待首 token（显示 spinner）
   *  streaming = 流式 token 到达中（显示内容 + 动画点）
   *  done      = 完成（显示内容 + 操作按钮）
   *  error     = 出错（显示错误文本）
   */
  status?: 'pending' | 'streaming' | 'done' | 'error'
  /** 用户消息携带的附件（仅展示用；已上传为 nomi-local）。 */
  attachments?: ComposerAttachment[]
  /** S3 轮次 footer:本轮 token 用量+缓存命中(S7 成本落地后切金额并删本形态,P1)。 */
  turnStats?: { totalTokens?: number; promptTokens?: number; cachedPromptTokens?: number }
}
