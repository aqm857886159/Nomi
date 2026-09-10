/**
 * [INPUT]: 依赖 ./migrateScene3d 的 migrateScene3DState、../model/directorNodeMeta 的 DIRECTOR_NODE_KIND / DIRECTOR_PROJECT_META_KEY
 * [OUTPUT]: 对外提供 LEGACY_SCENE3D_NODE_KIND、isLegacyScene3DNode、migrateScene3DNode（画布节点级：kind + meta）
 * [POS]: director/migration 的节点接缝：画布快照归一化（store/canvasSnapshotNormalizer）遇到 kind='scene3d' 的老节点就走这里——
 *        kind 改成 director，meta.scene3dState 迁成 meta.directorProject，AI 来导的自动出图标志（stagingAutoCapture / cameraMoveAutoCapture）
 *        原样保留给 director 的常驻 Host 消费；已是 director 且带 directorProject 的节点原样返回（幂等）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { DIRECTOR_NODE_KIND, DIRECTOR_PROJECT_META_KEY } from '../model/directorNodeMeta'
import { migrateScene3DState, type MigrationReport } from './migrateScene3d'

export const LEGACY_SCENE3D_NODE_KIND = 'scene3d'
export const LEGACY_SCENE3D_META_KEY = 'scene3dState'

type NodeLike = { kind?: unknown; title?: unknown; meta?: unknown }

export function isLegacyScene3DNode(node: NodeLike): boolean {
  return node.kind === LEGACY_SCENE3D_NODE_KIND
}

export type MigratedNode = { kind: typeof DIRECTOR_NODE_KIND; meta: Record<string, unknown>; report: MigrationReport | null }

/** 老 scene3d 节点 → director 节点（kind + meta）；没有 scene3dState 的空节点得到空工程。 */
export function migrateScene3DNode(node: NodeLike, sceneName: string): MigratedNode {
  const meta = node.meta && typeof node.meta === 'object' ? { ...(node.meta as Record<string, unknown>) } : {}
  if (meta[DIRECTOR_PROJECT_META_KEY]) return { kind: DIRECTOR_NODE_KIND, meta, report: null }
  const legacy = meta[LEGACY_SCENE3D_META_KEY]
  const { project, report } = migrateScene3DState(legacy ?? {}, { sceneName })
  delete meta[LEGACY_SCENE3D_META_KEY]
  meta[DIRECTOR_PROJECT_META_KEY] = project
  return { kind: DIRECTOR_NODE_KIND, meta, report }
}
