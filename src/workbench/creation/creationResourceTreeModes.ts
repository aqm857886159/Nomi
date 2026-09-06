import type { WorkspaceMode } from '../workbenchStore'

/**
 * 「创作资源树跟着哪些工作区走」的唯一 owner。
 *
 * 为什么需要一个 owner：原稿和它的分镜方案住在**两个**工作区（creation 写剧本、
 * storyboard 编分镜表），但它们共用同一棵资源树。树只要归其中一个工作区所有，
 * 另一个工作区就没有树——2026-09-06 用户报的回归正是这么来的（805096d41 让侧栏
 * 点方案直接切进 storyboard，而 storyboard 那面没有树，用户被钉死在单个方案上）。
 *
 * 所以挂载判断提到 WorkbenchShell（树的唯一挂载点）并由本常量决定：任何新的
 * 「切进分镜页」入口都自动带着树，不靠每个入口自觉。
 */
export const CREATION_RESOURCE_TREE_MODES = ['creation', 'storyboard'] as const satisfies readonly WorkspaceMode[]

export function workspaceModeCarriesCreationResourceTree(mode: WorkspaceMode): boolean {
  return (CREATION_RESOURCE_TREE_MODES as readonly WorkspaceMode[]).includes(mode)
}
