// 渲染层侧的**共用工厂依赖注入**：把 src 单一真相源（registry 尺寸 / i18n 标题 / kind→分类 /
// shotNumbering）喂给共享工厂 `electron/capabilityCore/canvasNodeFactory`。
// 与 electron 能力核注入 nodeKindDomain 纯表是同一份工厂逻辑 → 两路产出字段级等价（除 id/落点）。
// 渲染层永远吃**这份**（src 真函数）→ UI 路径不经镜像表，单一真相源不旁路。
import type { NodeFactoryDeps } from '../../../../electron/shared/canvas/canvasNodeFactory'
import {
  getGenerationNodeDefaultSize,
  getGenerationNodeDefaultTitle,
} from '../model/generationNodeKinds'
import { getDefaultCategoryForNodeKind, type GenerationNodeKind } from '../model/generationCanvasTypes'
import { isShotNumberedNode, nextShotIndex } from '../model/shotNumbering'
import { createNodeId } from './canvasIds'

/** 渲染层依赖：标题走 i18n（跟当前 App 语言），几何/分类/镜号走 src 单一真相源。 */
export const RENDERER_NODE_FACTORY_DEPS: NodeFactoryDeps = {
  createId: (kind) => createNodeId(kind as GenerationNodeKind),
  resolveSize: (kind) => getGenerationNodeDefaultSize(kind as GenerationNodeKind),
  resolveDefaultTitle: (kind) => getGenerationNodeDefaultTitle(kind as GenerationNodeKind),
  resolveCategory: (kind) => getDefaultCategoryForNodeKind(kind as GenerationNodeKind),
  isShotNumbered: (node) => isShotNumberedNode(node as { kind: GenerationNodeKind; categoryId?: string; meta?: Record<string, unknown> }),
  nextShotIndex: (existing) => nextShotIndex(existing as Parameters<typeof nextShotIndex>[0]),
}
