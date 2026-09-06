import type { ComposerAttachment } from './composer/composerAttachmentTypes'

export type WorkbenchAiMessage = {
  id: string
  /** Canonical Host turn identity used only for non-owning UI annotations/cards. */
  turnId?: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** assistant 消息生命周期状态。undefined 兼容旧 session 消息，视为 done。
   *  pending   = 已发送、等待首 token（显示 spinner）
   *  streaming = 流式 token 到达中（显示内容 + 动画点）
   *  done      = 完成（显示内容 + 操作按钮）
   *  error     = 出错（显示错误文本）
   *  cancelled = 用户主动「停止」（显示已生成的部分 + 「已停止」，非错误）
   */
  status?: 'pending' | 'streaming' | 'done' | 'error' | 'cancelled'
  /** 用户消息携带的附件（仅展示用；已上传为 nomi-local）。 */
  attachments?: ComposerAttachment[]
  /** 跨面板动作卡：assistant 消息携带可一键触发的动作（拆镜头/立角色卡）。
   *  识别到意图后不再静默开跑，而是推这张卡让用户看见并点击才落画布。
   *  prompt = 原始用户输入（按钮点击时传给 launch，供编辑器为空时抠故事）。 */
  action?: { kind: 'storyboard' | 'fixation'; prompt: string }
  /**
   * 这条 assistant 消息产出了分镜方案 → 方案卡挂在它下面，而不是常驻对话流尾部。
   *
   * 根因备忘（2026-08-17）：卡片原来渲染在 messages.map() 外面、是消息容器的最后一个子元素，
   * 于是结构上被钉死在列表末尾——用户每说一句话它就被顶到新消息下面，像在「跟着对话跑」。
   * 方案是某一轮的产出，就该锚在那一轮上（对齐同文件 action 卡的做法）。
   * 改方案会产出新的一条带标消息，卡片随之移到最新那条（取最后一条带标的）。
  */
  storyboardArtifact?: true
  /** Exact creation resource produced by this turn. Older persisted messages omit both fields. */
  storyboardDocumentId?: string
  storyboardDesignId?: string
}
