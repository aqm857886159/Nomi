import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from './generationCanvasStore'
import { releaseWorkbenchProjectRuntimeState } from '../../project/releaseWorkbenchProjectSession'

/**
 * `isReady` = 这个项目的画布内容已经载入，「打开时适应一次」（useAutoFitOnLoad）就是按它判的。
 *
 * 画布组件挂载时曾经也调 `markReady()` 写它：挂载不是「内容载入完」。挂载若先于 restoreSnapshot，
 * 适应在那一刻看到「ready 了、画布是空的」，按「打开时是空的就不摆」放弃，之后节点进来也不再触发。
 * 2026-09-26 一并删掉，只留 restoreSnapshot 一个写口（同一份合同里的第二扇门，见
 * docs/fixes/2026-09-26-open-fit-reopen-remembered-echo.root-cause.json）。
 */
const SRC = path.resolve(__dirname, '../../..')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function node(id: string): GenerationCanvasNode {
  return { id, kind: 'image', title: id, prompt: '', position: { x: 0, y: 0 } } as GenerationCanvasNode
}

describe('canvas isReady has one owner', () => {
  afterEach(() => releaseWorkbenchProjectRuntimeState())

  it('only the canvas store writes isReady (restoreSnapshot sets it, releaseProject clears it)', () => {
    const writers = sourceFiles(path.join(SRC, 'workbench'))
      .filter((file) => /\bisReady\s*:\s*(true|false)\b/.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
    expect(writers).toEqual(['workbench/generationCanvas/store/generationCanvasStore.ts'])
    expect('markReady' in useGenerationCanvasStore.getState(), '画布挂载不是「内容载入完」，不许再有 markReady 这扇门').toBe(false)
  })

  it('becomes ready in the same update that brings the project nodes', () => {
    releaseWorkbenchProjectRuntimeState()
    expect(useGenerationCanvasStore.getState().isReady).toBe(false)
    const seen: Array<{ ready: boolean; nodes: number }> = []
    const stop = useGenerationCanvasStore.subscribe((state) => seen.push({ ready: state.isReady, nodes: state.nodes.length }))
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node('a'), node('b')], edges: [], groups: [] })
    stop()
    // 任何一次通知里都不许出现「ready 了但节点还没到」——那正是适应会看到的空画布。
    expect(seen.filter((entry) => entry.ready && entry.nodes === 0)).toEqual([])
    expect(useGenerationCanvasStore.getState()).toMatchObject({ isReady: true })
    expect(useGenerationCanvasStore.getState().nodes.map((item) => item.id)).toEqual(['a', 'b'])
  })
})
