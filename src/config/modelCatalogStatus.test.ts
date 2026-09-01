import { describe, expect, it } from 'vitest'
import { deriveModelCatalogStatus, resolveCatalogKind } from './modelCatalogStatus'

describe('resolveCatalogKind', () => {
  it('maps each node kind to its own catalog bucket (never silently to text)', () => {
    expect(resolveCatalogKind('image')).toBe('image')
    expect(resolveCatalogKind('imageEdit')).toBe('image')
    expect(resolveCatalogKind('video')).toBe('video')
    expect(resolveCatalogKind('audio')).toBe('audio')
    // Regression: a 3D node must fetch from the 'model3d' catalog bucket. Falling
    // back to 'text' left the 3D composer's model selector permanently empty
    // (options filtered against text models by text_to_3d mode → nothing), so the
    // 3D generation path was stuck with no way to pick an already-onboarded model.
    expect(resolveCatalogKind('model3d')).toBe('model3d')
  })

  it('defaults unknown/text kinds to the text bucket', () => {
    expect(resolveCatalogKind('text')).toBe('text')
    expect(resolveCatalogKind(undefined)).toBe('text')
  })
})

// 类级回归：目录只读必须被报成**它自己**，且文案要说清「改不了 + 怎么办」。
// 这条 issue 之前没有对应分支，会落进泛化的 incomplete（「配置不完整」）——
// 那句话把用户引去「再配一次」，而配了也存不上，是最坏的一种误导。
describe('deriveModelCatalogStatus — 目录只读（盘上 schema 比本构建新）', () => {
  const readOnlyHealth = {
    ok: false,
    writable: false,
    diskVersion: 12,
    appVersion: 11,
    counts: {
      vendors: 0, enabledVendors: 0, models: 0, enabledModels: 0,
      mappings: 0, enabledMappings: 0, enabledApiKeys: 0,
    },
    byKind: [],
    issues: [
      {
        code: 'catalog_read_only_version_skew' as const,
        severity: 'error' as const,
        message: 'Catalog is read-only: on-disk version 12 > app version 11',
        diskVersion: 12,
        appVersion: 11,
      },
    ],
  }

  it('报成 catalog_read_only，而不是泛化的 incomplete / empty', () => {
    const result = deriveModelCatalogStatus({
      kind: 'image', options: [], health: readOnlyHealth, error: null, loading: false,
    })
    expect(result.status).toBe('catalog_read_only')
  })

  it('文案带出两个版本号，并说清「改不了」与唯一出路（更新 app）', () => {
    const { message } = deriveModelCatalogStatus({
      kind: 'image', options: [], health: readOnlyHealth, error: null, loading: false,
    })
    // 版本号 derive 自 health，不 hardcode。
    expect(message).toContain('v12')
    expect(message).toContain('v11')
    expect(message).toContain('只读')
    expect(message).toContain('更新')
    // 不许把主进程那句英文 Error.message 原样漏给用户。
    expect(message).not.toContain('refusing to write')
  })

  it('只读判定压过 catalog_empty —— 空目录只是只读的下游表现', () => {
    const result = deriveModelCatalogStatus({
      kind: 'image',
      options: [],
      health: {
        ...readOnlyHealth,
        issues: [
          ...readOnlyHealth.issues,
          { code: 'catalog_empty' as const, severity: 'error' as const, message: 'Local model catalog is empty' },
        ],
      },
      error: null,
      loading: false,
    })
    expect(result.status).toBe('catalog_read_only')
  })

  it('目录可写时不受影响（不制造假的只读态）', () => {
    const result = deriveModelCatalogStatus({
      kind: 'image',
      options: [],
      health: { ...readOnlyHealth, ok: false, writable: true, issues: [
        { code: 'catalog_empty' as const, severity: 'error' as const, message: 'Local model catalog is empty' },
      ] },
      error: null,
      loading: false,
    })
    expect(result.status).toBe('catalog_empty')
  })
})
