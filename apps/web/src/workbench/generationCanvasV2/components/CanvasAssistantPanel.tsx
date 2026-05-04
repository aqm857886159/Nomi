import { IconSend2, IconX } from '@tabler/icons-react'
import { NomiAILabel, WorkbenchButton, WorkbenchIconButton } from '../../../design'
import React from 'react'
import { buildPlannedEdges, toCreateNodeInputs } from '../agent/generationCanvasAgentPlan'
import { sendGenerationCanvasAgentMessage } from '../agent/generationCanvasAgentClient'
import { generationCanvasTools } from '../agent/generationCanvasTools'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { openWorkbenchModelIntegration, WorkbenchAiHeaderActions } from '../../ai/WorkbenchAiHeaderActions'
import { useWorkbenchStore } from '../../workbenchStore'

type CanvasAssistantPanelProps = {
  defaultCollapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

function createMessageId(): string {
  return `assistant-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function CanvasAssistantPanel({
  defaultCollapsed = false,
  onCollapsedChange,
}: CanvasAssistantPanelProps): JSX.Element {
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const snapshot = React.useMemo(() => generationCanvasTools.read_canvas(), [nodes, edges, selectedNodeIds])
  const selectedNodes = React.useMemo(() => generationCanvasTools.read_selected_nodes(), [nodes, selectedNodeIds])
  const [busy, setBusy] = React.useState(false)
  const draft = useWorkbenchStore((state) => state.generationAiDraft)
  const messages = useWorkbenchStore((state) => state.generationAiMessages)
  const collapsed = useWorkbenchStore((state) => state.generationAiCollapsed)
  const setDraft = useWorkbenchStore((state) => state.setGenerationAiDraft)
  const setMessages = useWorkbenchStore((state) => state.setGenerationAiMessages)
  const setCollapsed = useWorkbenchStore((state) => state.setGenerationAiCollapsed)
  const resetConversation = useWorkbenchStore((state) => state.resetGenerationAiConversation)

  React.useEffect(() => {
    if (messages.length === 0 && !draft.trim()) setCollapsed(defaultCollapsed)
  }, [defaultCollapsed, draft, messages.length, setCollapsed])

  React.useEffect(() => {
    onCollapsedChange?.(collapsed)
  }, [collapsed, onCollapsedChange])

  const appendMessage = React.useCallback((message: { role: 'assistant' | 'user' | 'tool'; content: string }) => {
    setMessages((current) => [...current, { id: createMessageId(), ...message }])
  }, [setMessages])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    appendMessage({ role: 'user', content: text })
    setBusy(true)
    void (async () => {
      try {
        const result = await sendGenerationCanvasAgentMessage({ message: text, snapshot, selectedNodes })
        const nodeInputs = toCreateNodeInputs(result.plan)
        const createdNodes = generationCanvasTools.create_nodes(nodeInputs)
        const edges = buildPlannedEdges(result.plan, createdNodes.map((node) => node.id))
        if (edges.length > 0) generationCanvasTools.connect_nodes(edges)
        appendMessage({
          role: 'assistant',
          content: `已创建 ${createdNodes.length} 个待确认节点${edges.length > 0 ? `，并连接 ${edges.length} 条关系` : ''}。你可以先检查提示词，再点击节点上的生成按钮。`,
        })
      } catch (error: unknown) {
        appendMessage({
          role: 'assistant',
          content: `生成区 Agent 执行失败：${error instanceof Error && error.message ? error.message : '未知错误'}`,
        })
      } finally {
        setBusy(false)
      }
    })()
  }

  const handleNewConversation = React.useCallback(() => {
    resetConversation()
  }, [resetConversation])

  if (collapsed) {
    return (
      <aside className="generation-canvas-v2-assistant" data-collapsed="true" aria-label="生成区 AI">
        <WorkbenchButton
          className="generation-canvas-v2-assistant__launcher"
          onClick={() => setCollapsed(false)}
        >
          <NomiAILabel markSize={18} wordSize={13} suffix="生成" />
        </WorkbenchButton>
      </aside>
    )
  }

  return (
    <aside className="generation-canvas-v2-assistant" data-collapsed="false" aria-label="生成区 AI">
      <header className="generation-canvas-v2-assistant__header">
        <div className="generation-canvas-v2-assistant__title">
          <NomiAILabel suffix="生成" />
        </div>
        <div className="generation-canvas-v2-assistant__header-actions">
          <WorkbenchAiHeaderActions
            className="generation-canvas-v2-assistant__shared-actions"
            actionClassName="generation-canvas-v2-assistant__header-action"
            onModelIntegration={openWorkbenchModelIntegration}
            onNewConversation={handleNewConversation}
          />
          <WorkbenchIconButton
            className="generation-canvas-v2-assistant__collapse"
            label="收起 AI"
            onClick={() => setCollapsed(true)}
            icon={<IconX size={14} />}
          />
        </div>
      </header>
      <div className="generation-canvas-v2-assistant__body">
        {messages.length === 0 ? (
          <div className="generation-canvas-v2-assistant__empty">
            <div className="generation-canvas-v2-assistant__empty-title">需要 AI 帮忙？</div>
            <div className="generation-canvas-v2-assistant__empty-sub">
              告诉 AI 你想怎么改，它会写入待确认节点。
            </div>
            <div className="generation-canvas-v2-assistant__suggestions">
              {['把第一帧改成黄昏色调', '在末尾追加一帧', '整体风格统一为水彩'].map((suggestion) => (
                <WorkbenchButton
                  key={suggestion}
                  className="generation-canvas-v2-assistant__suggestion"
                  onClick={() => setDraft(suggestion)}
                >
                  {suggestion}
                </WorkbenchButton>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="generation-canvas-v2-assistant__message" data-role={message.role}>
              {message.content}
            </div>
          ))
        )}
      </div>
      <form className="generation-canvas-v2-assistant__composer" onSubmit={handleSubmit}>
        <textarea
          className="generation-canvas-v2-assistant__input"
          aria-label="给生成助手发送消息"
          rows={1}
          placeholder="输入你的设计需求..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={busy}
        />
        <div className="generation-canvas-v2-assistant__composer-row">
          <label className="generation-canvas-v2-assistant__mode">
            <span>模式</span>
            <select aria-label="AI 模式" defaultValue="Agent">
              <option>Agent</option>
              <option>问答</option>
              <option>润色</option>
            </select>
          </label>
          <WorkbenchIconButton
            type="submit"
            className="generation-canvas-v2-assistant__send"
            disabled={busy || !draft.trim()}
            label="发送"
            icon={<IconSend2 size={15} />}
          />
        </div>
      </form>
    </aside>
  )
}
