import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { ensureFreshElectronDist, isElectronDistStale } from './ensureFreshElectronDist.mjs'

const cleanups = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) cleanupTestTemp(dir)
})

function setupFixture() {
  const root = makeTempDir('nomi-fresh-electron-dist-')
  cleanups.push(root)
  const srcFile = path.join(root, 'electron/agentLane/laneToolInputBoundary.mts')
  const buildScript = path.join(root, 'scripts/build-electron.mjs')
  const distFile = path.join(root, 'dist-electron/agentLane/laneToolInputBoundary.mjs')
  fs.mkdirSync(path.dirname(srcFile), { recursive: true })
  fs.mkdirSync(path.dirname(buildScript), { recursive: true })
  fs.mkdirSync(path.dirname(distFile), { recursive: true })
  fs.writeFileSync(srcFile, 'export const v = 1\n')
  fs.writeFileSync(buildScript, '// build\n')
  fs.writeFileSync(distFile, 'export const v = 1\n')
  return { root, srcFile, buildScript, distFile }
}

function setMtime(filePath, sec) {
  fs.utimesSync(filePath, sec, sec)
}

describe('ensureFreshElectronDist', () => {
  it('产物齐全且不旧于源码时不重建', () => {
    const { root, srcFile, buildScript, distFile } = setupFixture()
    setMtime(srcFile, 1_700_000_000)
    setMtime(buildScript, 1_700_000_000)
    setMtime(distFile, 1_700_000_010)

    let rebuilt = 0
    const didRebuild = ensureFreshElectronDist({
      repoRoot: root,
      requiredArtifacts: ['dist-electron/agentLane/laneToolInputBoundary.mjs'],
      rebuild: () => { rebuilt += 1 },
    })

    expect(didRebuild).toBe(false)
    expect(rebuilt).toBe(0)
  })

  it('任一 electron 源码比产物新时判定过期并触发重建', () => {
    const { root, srcFile, buildScript, distFile } = setupFixture()
    setMtime(buildScript, 1_700_000_000)
    setMtime(distFile, 1_700_000_010)
    setMtime(srcFile, 1_700_000_020)

    let rebuilt = 0
    const didRebuild = ensureFreshElectronDist({
      repoRoot: root,
      requiredArtifacts: ['dist-electron/agentLane/laneToolInputBoundary.mjs'],
      rebuild: () => { rebuilt += 1 },
    })

    expect(didRebuild).toBe(true)
    expect(rebuilt).toBe(1)
  })

  it('构建脚本本身比产物新时同样触发重建', () => {
    const { root, srcFile, buildScript, distFile } = setupFixture()
    setMtime(srcFile, 1_700_000_000)
    setMtime(distFile, 1_700_000_010)
    setMtime(buildScript, 1_700_000_020)

    expect(isElectronDistStale({
      repoRoot: root,
      requiredArtifacts: ['dist-electron/agentLane/laneToolInputBoundary.mjs'],
    })).toBe(true)
  })

  it('产物缺失时触发重建', () => {
    const { root, distFile } = setupFixture()
    fs.rmSync(distFile)

    let rebuilt = 0
    const didRebuild = ensureFreshElectronDist({
      repoRoot: root,
      requiredArtifacts: ['dist-electron/agentLane/laneToolInputBoundary.mjs'],
      rebuild: () => { rebuilt += 1 },
    })

    expect(didRebuild).toBe(true)
    expect(rebuilt).toBe(1)
  })

  it('只改了测试文件不算生产源码过期', () => {
    const { root, srcFile, buildScript, distFile } = setupFixture()
    const testFile = path.join(root, 'electron/agentLane/laneToolInputBoundary.test.ts')
    fs.writeFileSync(testFile, '// test\n')
    setMtime(srcFile, 1_700_000_000)
    setMtime(buildScript, 1_700_000_000)
    setMtime(distFile, 1_700_000_010)
    setMtime(testFile, 1_700_000_030)

    expect(isElectronDistStale({
      repoRoot: root,
      requiredArtifacts: ['dist-electron/agentLane/laneToolInputBoundary.mjs'],
    })).toBe(false)
  })
})
