import type { ComposerAttachment } from './composer/composerAttachmentTypes'

export type WorkbenchAiMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** 用户消息携带的附件（仅展示用；已上传为 nomi-local）。 */
  attachments?: ComposerAttachment[]
  /** S3 轮次 footer:本轮 token 用量+缓存命中(S7 成本落地后切金额并删本形态,P1)。 */
  turnStats?: { totalTokens?: number; promptTokens?: number; cachedPromptTokens?: number }
}
