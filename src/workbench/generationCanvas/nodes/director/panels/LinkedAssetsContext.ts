/**
 * [INPUT]: 依赖 react、../model/directorTypes 的 DirectorLinkedAsset
 * [OUTPUT]: 对外提供 LinkedAssetsContext、useLinkedAssets()
 * [POS]: director/panels 的「连线引用」注入：画布节点把连进来的全景 / 泼溅 / 模型 url 交给编辑器（DirectorEditor 提供），资产库面板只读消费；
 *        不入工程、不入 store（连线增减即变，工程里存的是加入场景后的对象）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import type { DirectorLinkedAsset } from '../model/directorTypes'

export const EMPTY_LINKED_ASSETS: readonly DirectorLinkedAsset[] = []

export const LinkedAssetsContext = React.createContext<readonly DirectorLinkedAsset[]>(EMPTY_LINKED_ASSETS)

export function useLinkedAssets(): readonly DirectorLinkedAsset[] {
  return React.useContext(LinkedAssetsContext)
}
