import { getDefaultCategoryForNodeKind, type GenerationCanvasSnapshot } from '../model/generationCanvasTypes'

// 契约：创建路径的产物必须是「已迁移形态」（categoryId 出生即带上），过
// projectCategoryMigration 必须 no-op——否则新建项目会弹「已升级」迁移 toast，
// 甚至被迁移误删节点（审计 A4）。该契约由 projectCategoryMigration.test 钉住。
export function createDefaultGenerationCanvasSnapshot(): GenerationCanvasSnapshot {
  const textNode: GenerationCanvasSnapshot['nodes'][number] = {
    id: 'gen-v2-text-1',
    kind: 'text',
    title: '剧本片段',
    position: { x: 96, y: 360 },
    size: { width: 280, height: 170 },
    prompt: '写下镜头、角色或画面提示词。',
    references: [],
    history: [],
    status: 'idle',
    meta: {},
    categoryId: getDefaultCategoryForNodeKind('text'),
  }
  const imageNode: GenerationCanvasSnapshot['nodes'][number] = {
    id: 'gen-v2-image-1',
    kind: 'image',
    title: '关键画面',
    position: { x: 440, y: 380 },
    size: { width: 340, height: 280 },
    prompt: '',
    references: [],
    history: [],
    status: 'idle',
    meta: {},
    categoryId: getDefaultCategoryForNodeKind('image'),
  }
  return {
    nodes: [textNode, imageNode],
    edges: [{ id: 'edge-gen-v2-text-1-gen-v2-image-1', source: textNode.id, target: imageNode.id }],
    selectedNodeIds: [],
    groups: [],
  }
}
