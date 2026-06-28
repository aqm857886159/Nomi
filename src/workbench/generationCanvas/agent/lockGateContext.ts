// 锁求值上下文构建器(harness S6-4)。gate.ts 保持纯函数(不进 store),
// 调用方(面板/auto 路径)经此把「当前锁面 + clientId 翻译」喂给 evaluateGate。
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { resolveCanvasToolNodeId } from './clientIdRegistry'
import type { GateContext } from './gate'

export function buildLockGateContext(): GateContext {
  const nodes = useGenerationCanvasStore.getState().nodes
  const lockedNodes = new Map(nodes.filter((node) => node.locked).map((node) => [node.id, node.title]))
  return { lockedNodes, resolveNodeId: resolveCanvasToolNodeId }
}
