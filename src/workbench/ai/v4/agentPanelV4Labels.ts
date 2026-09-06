// Agent 面板 v4 · 各积木的可见文字**单一取处**（R15：可见文字必须走 i18n）。
//
// 为什么集中：同一个词（「完成」「撤销」「不要」）会出现在收据、任务卡、介入槽三个积木上。
// 每个组件各 `t()` 一次，改文案要改三处，漏一处就是两个说法——那正是 R14.1 要横扫的东西。
import { useTranslation } from 'react-i18next'
import type { QueueRowData, V4TaskStatus, V4ToolStatus } from './agentPanelV4Types'

export function useV4Labels() {
  const { t } = useTranslation()
  const toolStatus: Record<V4ToolStatus, string> = {
    'input-streaming': t('agentPanelV4.toolStatus.inputStreaming'),
    'input-available': t('agentPanelV4.toolStatus.inputAvailable'),
    'approval-requested': t('agentPanelV4.toolStatus.approvalRequested'),
    'approval-responded': t('agentPanelV4.toolStatus.approvalResponded'),
    'output-available': t('agentPanelV4.toolStatus.outputAvailable'),
    'output-denied': t('agentPanelV4.toolStatus.outputDenied'),
    'output-error': t('agentPanelV4.toolStatus.outputError'),
  }
  const taskStatus: Record<V4TaskStatus, string> = {
    queued: t('agentPanelV4.taskStatus.queued'),
    running: t('agentPanelV4.taskStatus.running'),
    complete: t('agentPanelV4.taskStatus.complete'),
    failed: t('agentPanelV4.taskStatus.failed'),
    stopped: t('agentPanelV4.taskStatus.stopped'),
  }
  const queue: Record<QueueRowData['status'], string> = {
    queued: t('agentPanelV4.queueStatus.queued'),
    running: t('agentPanelV4.queueStatus.running'),
    complete: t('agentPanelV4.queueStatus.complete'),
  }
  return {
    toolStatus,
    queue,
    assistant: {
      copy: t('agentPanelV4.copyReply'),
      retry: t('agentPanelV4.retry'),
      continue: t('agentPanelV4.continue'),
    },
    task: { status: taskStatus, adopt: t('agentPanelV4.adopt'), undo: t('agentPanelV4.undo') },
    intervention: {
      confirm: t('agentPanelV4.confirm'),
      reject: t('agentPanelV4.reject'),
      escalate: t('agentPanelV4.escalate'),
      cancel: t('agentPanelV4.cancel'),
      confirmReject: t('agentPanelV4.confirmReject'),
      collapsePlan: t('agentPanelV4.collapsePlan'),
    },
    context: {
      context: t('agentPanelV4.context'),
      input: t('agentPanelV4.input'),
      output: t('agentPanelV4.output'),
      reasoning: t('agentPanelV4.reasoning'),
      cache: t('agentPanelV4.cache'),
      threadCost: t('agentPanelV4.threadCost'),
    },
    dock: { conversation: t('agentPanelV4.dockConversation'), adjust: t('agentPanelV4.dockAdjust') },
  }
}
