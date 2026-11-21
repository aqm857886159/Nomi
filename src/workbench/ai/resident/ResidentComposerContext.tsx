import React from 'react'
import type { DocumentAnchorRef, TargetRef } from '../../../../electron/shared/capabilityTargeting'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { timelineRevision } from '../../timeline/kernel/timelineKernel'
import { getDocumentSessionPort } from '../../project/documentSessionPort'
import { agentReferenceContext } from './agentReferenceContext'
import { mergeResidentContextHandles, residentSelectionInput, resolveResidentSelection, type AgentContextSnapshot } from './residentContextSnapshot'
import i18n from '../../../i18n'
import { readDirectorShotFocus } from '../../generationCanvas/nodes/director/directorSessionRegistry'
import { directorShotContextHandles } from '../../generationCanvas/nodes/director/model/directorShotFocus'
import type { ResidentSurface } from './residentShellDisplay'
import type { V4ComposerReference } from '../v4/agentPanelV4Types'
import type { SkillListItemDto } from '../../api/skillApi'
import { skillForKey } from '../../skillLibrary/skillDisplay'
import { useResidentTimelineReferences } from './timelineAgentSurface'
import { laneClient } from '../lane/laneClient'

type ResidentSendContext = Readonly<{
  context: Readonly<{ target: TargetRef; contextSnapshot: AgentContextSnapshot }>
  activeDocumentId: string
  documentState: Readonly<{ revision: number; contentHash: string; anchor: DocumentAnchorRef }>
}>

/**
 * 在 enqueue **前的同一个同步回合里**把所有域选中读一遍。
 * composer 绝不能发一个「用户打字期间已经变了的」渲染期选中：这份快照由纯构造器冻结，
 * 随请求一起走。选了什么只由 `resolveResidentSelection` 算一次，目标和快照都拿它的结果。
 */
export function captureResidentSendContext(surface: ResidentSurface, prompt:string, attachments:readonly import('../composer/composerAttachmentTypes').ComposerAttachment[]): ResidentSendContext {
  const workbench = useWorkbenchStore.getState()
  const canvas = useGenerationCanvasStore.getState()
  const activeDocumentId = workbench.activeDocumentId
  const document = workbench.workbenchDocuments.find((item) => item.id === activeDocumentId)
  // 文稿状态由项目会话层 owner 给，不看页面身份：画布/预览面上一样能读、能整篇追加。
  // 在创作页它带光标锚，在别的面是 whole-document——两种都是当下真实的、可验的前提。
  const documentState = getDocumentSessionPort().readState()
  const selection = resolveResidentSelection(residentSelectionInput(surface, {
    document: document
      ? {
          id: document.id,
          revision: documentState.revision,
          anchor: documentState.anchor,
          title: document.title,
        }
      : null,
    workbench,
    canvas,
    readTimelineRevision: () => timelineRevision(workbench.timeline),
  }))
  // 3D-BOX：导演台里选中的计划镜头随这一句一起走（「正在改：镜头 N」的数据；模型按镜头名补丁）
  const directorShots = surface === 'generation'
    ? directorShotContextHandles(readDirectorShotFocus(), (index) => i18n.t('director.agent.focusShot', { index }), i18n.t('director.agent.boxPreview'))
    : []
  const snapshot = mergeResidentContextHandles(selection.snapshot, [...directorShots, ...agentReferenceContext(attachments,prompt,canvas.nodes,canvas.persistRevision)])
  const target: TargetRef = surface === 'preview' ? { kind: 'timeline', clipIds: selection.timelineClipIds }
    : surface === 'generation' ? { kind: 'canvas', nodeIds: selection.canvasNodeIds }
      : { kind: 'document', documentId: activeDocumentId, anchor: documentState.anchor }
  return Object.freeze({ context: Object.freeze({ target, contextSnapshot: snapshot }), activeDocumentId, documentState })
}

/** 五种当前内容在这里绑定自己的移除动作；外壳只摆结果。 */
export function useResidentComposerContext(surface: ResidentSurface, skills: readonly SkillListItemDto[], skillLabel: (key: string) => string, removeAttachment: (id: string) => void): readonly V4ComposerReference[] {
  const activeSkill = useWorkbenchStore(state => state.creationActiveSkill)
  const prompt = useWorkbenchStore(state => state.selectedLibraryPrompt)
  const attachments = useWorkbenchStore(state => state.projectAgentAttachments)
  React.useSyncExternalStore(laneClient.subscribe, laneClient.workspace, laneClient.workspace)
  const owner = laneClient.context()
  const address = laneClient.conversation()
  // 项目切换先卸载面板；本地取消不依赖助手已连接。
  const mounted = React.useRef(true)
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const isCurrent = () => {
    const now = laneClient.conversation()
    return mounted.current && laneClient.context() === owner
      && now?.workspaceId === address?.workspaceId && now?.laneName === address?.laneName && now?.sessionId === address?.sessionId
  }
  const timeline = useResidentTimelineReferences(surface, isCurrent)
  const chips: V4ComposerReference[] = attachments.map(attachment => ({
    id: attachment.id, kind: 'file', label: attachment.fileName, description: attachment.error,
    onRemove: () => { if (isCurrent()) removeAttachment(attachment.id) },
  }))
  if (activeSkill) {
    const skill = skillForKey(skills, activeSkill.key)
    chips.push({ id: `skill:${activeSkill.key}`, kind: 'skill', label: skillLabel(activeSkill.key), cover: skill?.cover, preview: skill?.preview, description: skill?.description ?? undefined,
      onRemove: () => { if (isCurrent()) useWorkbenchStore.getState().setCreationActiveSkill(null) } })
  } else if (prompt) chips.push({ id: `prompt:${prompt.id}`, kind: 'skill', label: prompt.title, cover: prompt.mediaType === 'image' ? prompt.mediaUrl : undefined,
    preview: prompt.mediaUrl ? { url: prompt.mediaUrl, type: prompt.mediaType } : undefined, description: prompt.prompt,
    onRemove: () => { if (isCurrent()) useWorkbenchStore.getState().setSelectedLibraryPrompt(null) } })
  return [...chips, ...timeline]
}
