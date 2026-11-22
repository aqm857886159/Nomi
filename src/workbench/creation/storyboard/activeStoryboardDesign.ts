import type { useWorkbenchStore } from '../../workbenchStore'
import type { StoryboardDesign } from '../../workbenchTypes'

type DesignState = Pick<ReturnType<typeof useWorkbenchStore.getState>, 'activeDocumentId' | 'activeStoryboardId' | 'storyboardDesignsByDocumentId'>

/**
 * 分镜页正在看的那份方案：当前文稿下 id 为 activeStoryboardId 的那份，没有就取第一份。
 * 分镜页（StoryboardWorkspace / StoryboardPlanEditor）和镜头提示词框的 owner 读的都是这一个选择——
 * 框出生时按 store 里此刻的方案读提示词，和页面显示的是同一份。
 */
export function selectActiveStoryboardDesign(state: DesignState): StoryboardDesign | null {
  const designs = state.activeDocumentId ? state.storyboardDesignsByDocumentId[state.activeDocumentId] ?? [] : []
  return designs.find((design) => design.id === state.activeStoryboardId) ?? designs[0] ?? null
}
