import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_FILE_TYPES,
  canArtifactBecomeReference,
  isArtifactFileType,
  readAgentArtifactMeta,
  type AgentArtifactMeta,
} from './artifactMeta'
import { GENERATION_NODE_PLUGIN_BY_KIND } from '../nodes/registry'
import { resolveNodeRenderKind } from '../nodes/resolveRenderKind'

describe('agent-artifact meta（meta.artifact 读写与校验）', () => {
  const valid: AgentArtifactMeta = { fileType: 'svg', url: 'nomi-local://asset/proj/a.svg' }

  it('合法 meta 可读回', () => {
    expect(readAgentArtifactMeta({ meta: { artifact: valid } })).toEqual(valid)
  })

  it('缺 artifact / 非对象 / 缺 url / 未知 fileType → undefined（宽松兜底）', () => {
    expect(readAgentArtifactMeta({ meta: {} })).toBeUndefined()
    expect(readAgentArtifactMeta({ meta: { artifact: 42 } })).toBeUndefined()
    expect(readAgentArtifactMeta({ meta: { artifact: { fileType: 'svg' } } })).toBeUndefined()
    expect(readAgentArtifactMeta({ meta: { artifact: { fileType: 'unknown', url: 'x' } } })).toBeUndefined()
    expect(readAgentArtifactMeta({ meta: undefined })).toBeUndefined()
  })

  it('fileType 词表闭合且 reader 只认词表内值', () => {
    for (const fileType of ARTIFACT_FILE_TYPES) {
      expect(isArtifactFileType(fileType)).toBe(true)
    }
    expect(isArtifactFileType('pptx')).toBe(false)
    expect(isArtifactFileType(undefined)).toBe(false)
  })

  it('v1 只有 svg 可固化为参考图（其余 P1）', () => {
    expect(canArtifactBecomeReference('svg')).toBe(true)
    for (const fileType of ARTIFACT_FILE_TYPES) {
      if (fileType !== 'svg') expect(canArtifactBecomeReference(fileType)).toBe(false)
    }
  })
})

describe('agent-artifact kind 注册', () => {
  it('registry 含 agent-artifact 且语义正确', () => {
    const plugin = GENERATION_NODE_PLUGIN_BY_KIND['agent-artifact']
    expect(plugin).toBeDefined()
    expect(plugin.agentCreatable).toBe(true)
    expect(plugin.executionKind).toBeUndefined() // 非生成节点：无 composer、无重新生成
    expect(plugin.quickAdd).toBe(false) // 用户不手动加空节点
    expect(plugin.providesImageReference).toBeUndefined() // 参考语义归固化后的 asset，不双源
  })

  it('asset 与 agent-artifact 的壳类判定不误伤（素材规则不受影响）', () => {
    // agent-artifact 与 asset 同属「壳内 kind 专属渲染」：任何分类都强制 renderKind=undefined
    // （否则落进 cast/scene/prop 会被 NodeCardBody 当角色/场景/道具卡渲染，preview 分支被隐藏）。
    expect(resolveNodeRenderKind({ kind: 'agent-artifact', renderKind: undefined, categoryId: 'shots' })).toBeUndefined()
    expect(resolveNodeRenderKind({ kind: 'agent-artifact', renderKind: undefined, categoryId: 'cast' })).toBeUndefined()
    expect(resolveNodeRenderKind({ kind: 'agent-artifact', renderKind: undefined, categoryId: 'scene' })).toBeUndefined()
    // 且 asset 的既有规则完全不受影响（回归）。
    expect(resolveNodeRenderKind({ kind: 'asset', renderKind: undefined, categoryId: 'cast' })).toBeUndefined()
    expect(resolveNodeRenderKind({ kind: 'image', renderKind: undefined, categoryId: 'cast' })).toBe('character-card')
  })
})
