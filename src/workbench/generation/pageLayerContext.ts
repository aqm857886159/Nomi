/**
 * [INPUT]: 依赖 react
 * [OUTPUT]: 对外提供 GenerationPageLayerProvider（只有 GenerationWorkspace 用）、useGenerationPageLayerState（GenerationPageLayer 取挂载点）、
 *           useGenerationPageLayerActive（这一格此刻看不看得见）、GenerationPageLayerState
 * [POS]: 生成页「页内全屏层」的上下文（挂载点 + 看不看得见）。和组件分文件：组件文件只导出组件（热更新），上下文 / hook 住这里。
 *        没有 Provider（设计实验室、单测）时 host 为空、active 恒真：GenerationPageLayer 什么也不挂，调用方在实验室里自己摆格子。
 *        合同与归属见 pageLayer.tsx 的头部与 docs/engineering/concept-owners/ui.generation-page-layer.json。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'

export type GenerationPageLayerState = {
  /** 页格元素（生成页「画布那一格」）；还没挂上 = null。 */
  host: HTMLElement | null
  /** 这一格此刻看得见：生成页是当前页 && 画布视图（列表视图开着时画布那一格是被藏起来的）。 */
  active: boolean
}

const GenerationPageLayerContext = React.createContext<GenerationPageLayerState>({ host: null, active: true })

/** 只有 GenerationWorkspace 提供：host 是它的画布格，active 是它算出来的「这一格看不看得见」。 */
export function GenerationPageLayerProvider({ value, children }: { value: GenerationPageLayerState; children: React.ReactNode }): React.ReactElement {
  return React.createElement(GenerationPageLayerContext.Provider, { value }, children)
}

/** 挂载点与可见性的整份状态（GenerationPageLayer 用；别处要的只是 active，用下面那个）。 */
export function useGenerationPageLayerState(): GenerationPageLayerState {
  return React.useContext(GenerationPageLayerContext)
}

/**
 * 这一格此刻看不看得见。藏着（切走生成页 / 列表视图）时，层里的人要停三件事：
 * ① 挂在 window 上的键盘监听（Esc 与快捷键不许吞掉别的页的键）；② 3D 渲染循环；③ 整个 App 级的暗色锁。
 */
export function useGenerationPageLayerActive(): boolean {
  return React.useContext(GenerationPageLayerContext).active
}
