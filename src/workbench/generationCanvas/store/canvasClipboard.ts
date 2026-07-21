// 画布剪贴板(harness S5-b-0:从 canvasHistory.ts 迁出)。
// 评审 P1 在案:canvasHistory 将随翻正删除,但它混装着剪贴板——P1 纪律"旧的有价值
// → 先把价值迁走再删"。本模块只管 copy/cut/paste 的数据面,语义逐字等价。
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { CLIPBOARD_OFFSET, createClipboardNodeId } from './canvasIds'
import i18n from '../../../i18n'

export type GenerationCanvasClipboard = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
}

export type ClipboardPastePayload = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  selectedNodeIds: string[]
}

let clipboard: GenerationCanvasClipboard | null = null

export function hasClipboardContent(): boolean {
  return clipboard !== null
}

export function setClipboard(payload: GenerationCanvasClipboard | null): void {
  clipboard = payload
}

export function getClipboard(): GenerationCanvasClipboard | null {
  return clipboard
}

export function clearClipboard(): void {
  clipboard = null
}

export function buildSelectedClipboard(
  state: { selectedNodeIds: string[]; nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[] },
): GenerationCanvasClipboard | null {
  const selected = new Set(state.selectedNodeIds)
  if (!selected.size) return null
  const nodes = state.nodes.filter((node) => selected.has(node.id))
  if (!nodes.length) return null
  return {
    nodes,
    edges: state.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target)),
  }
}

export function cloneClipboardPayload(payload: GenerationCanvasClipboard): ClipboardPastePayload {
  const idMap = new Map<string, string>()
  const nodes = payload.nodes.map((node) => {
    const nextId = createClipboardNodeId(node.id)
    idMap.set(node.id, nextId)
    return {
      ...node,
      id: nextId,
      title: node.title ? i18n.t('generationCommon.whiteboard.copyName', { name: node.title }) : node.title,
      position: {
        x: node.position.x + CLIPBOARD_OFFSET,
        y: node.position.y + CLIPBOARD_OFFSET,
      },
    }
  })
  const edges = payload.edges.flatMap((edge) => {
    const source = idMap.get(edge.source)
    const target = idMap.get(edge.target)
    if (!source || !target) return []
    return [{
      ...edge,
      id: `edge-${source}-${target}`,
      source,
      target,
    }]
  })
  return {
    nodes,
    edges,
    selectedNodeIds: nodes.map((node) => node.id),
  }
}

export function __resetCanvasClipboardForTests(): void {
  clipboard = null
}
