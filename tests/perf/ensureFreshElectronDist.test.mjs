import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { ensureFreshElectronDist, isElectronDistStale } from './ensureFreshElectronDist.mjs'

const cleanups = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) cleanupTestTemp(dir)
})

const ARTIFACT = 'dist-electron/agentLane/laneToolInputBoundary.mjs'
const STAMP = 'dist-electron/.source-tree'

function setupFixture({ withArtifact = true, recordedTree = null } = {}) {
  const root = makeTempDir('nomi-fresh-electron-dist-')
  cleanups.push(root)
  if (withArtifact) {
    const distFile = path.join(root, ARTIFACT)
    fs.mkdirSync(path.dirname(distFile), { recursive: true })
    fs.writeFileSync(distFile, 'export const v = 1\n')
  }
  if (recordedTree !== null) {
    const stampPath = path.join(root, STAMP)
    fs.mkdirSync(path.dirname(stampPath), { recursive: true })
    fs.writeFileSync(stampPath, `${recordedTree}\n`)
  }
  return root
}

describe('ensureFreshElectronDist', () => {
  it('产物齐全且 .source-tree 与当前 tree 一致时不重建', () => {
    const root = setupFixture({ withArtifact: true, recordedTree: 'tree-aaa' })
    let rebuilt = 0
    const didRebuild = ensureFreshElectronDist({
      repoRoot: root,
      requiredArtifacts: [ARTIFACT],
      computeTree: () => 'tree-aaa',
      rebuild: () => { rebuilt += 1 },
    })

    expect(didRebuild).toBe(false)
    expect(rebuilt).toBe(0)
  })

  it('源码 tree 变化时判定过期、触发重建并写下新 tree，再次调用不再重建', () => {
    const root = setupFixture({ withArtifact: true, recordedTree: 'tree-old' })
    let rebuilt = 0
    const first = ensureFreshElectronDist({
      repoRoot: root,
      requiredArtifacts: [ARTIFACT],
      computeTree: () => 'tree-new',
      rebuild: () => { rebuilt += 1 },
    })

    expect(first).toBe(true)
    expect(rebuilt).toBe(1)
    expect(fs.readFileSync(path.join(root, STAMP), 'utf8').trim()).toBe('tree-new')

    const second = ensureFreshElectronDist({
      repoRoot: root,
      requiredArtifacts: [ARTIFACT],
      computeTree: () => 'tree-new',
      rebuild: () => { rebuilt += 1 },
    })
    expect(second).toBe(false)
    expect(rebuilt).toBe(1)
  })

  it('旧产物缺少 .source-tree 戳时判定过期并触发重建', () => {
    const root = setupFixture({ withArtifact: true, recordedTree: null })
    expect(isElectronDistStale({
      repoRoot: root,
      requiredArtifacts: [ARTIFACT],
      computeTree: () => 'tree-aaa',
    })).toBe(true)

    let rebuilt = 0
    const didRebuild = ensureFreshElectronDist({
      repoRoot: root,
      requiredArtifacts: [ARTIFACT],
      computeTree: () => 'tree-aaa',
      rebuild: () => { rebuilt += 1 },
    })
    expect(didRebuild).toBe(true)
    expect(rebuilt).toBe(1)
  })

  it('即使 .source-tree 一致，只要任一必需产物缺失仍触发重建', () => {
    const root = setupFixture({ withArtifact: false, recordedTree: 'tree-aaa' })
    expect(isElectronDistStale({
      repoRoot: root,
      requiredArtifacts: [ARTIFACT],
      computeTree: () => 'tree-aaa',
    })).toBe(true)

    let rebuilt = 0
    const didRebuild = ensureFreshElectronDist({
      repoRoot: root,
      requiredArtifacts: [ARTIFACT],
      computeTree: () => 'tree-aaa',
      rebuild: () => { rebuilt += 1 },
    })
    expect(didRebuild).toBe(true)
    expect(rebuilt).toBe(1)
  })
})
