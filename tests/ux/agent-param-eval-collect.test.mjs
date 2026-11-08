// 取证读口的离线单测：run.json 读出来能归一成镜头表；坏文件不拖垮整题；没有目录返回空。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { readCanvasSummary, readRunJsons, taskTrajectory } from './agent-param-eval-collect.mjs'
import { planShotsFromRuns } from './agent-param-eval-judge.mjs'

describe('取证读口', () => {
  it('没有 .nomi/runs 时返回空，不抛', () => {
    const dir = makeTempDir('param-eval-collect-empty-')
    expect(readRunJsons(dir)).toEqual({ runs: [], unreadable: [] })
    expect(readCanvasSummary(dir)).toEqual({ nodes: [] })
  })
  it('读出 run.json 并归一镜头表；坏 JSON 记名字不拖垮', () => {
    const dir = makeTempDir('param-eval-collect-runs-')
    const runs = path.join(dir, '.nomi', 'runs')
    fs.mkdirSync(path.join(runs, 'op-a'), { recursive: true })
    fs.mkdirSync(path.join(runs, 'op-bad'), { recursive: true })
    fs.writeFileSync(path.join(runs, 'op-a', 'run.json'), JSON.stringify({ run: { runId: 'op-a', createdAt: 1, generationPlan: { operationId: 'op-a', shots: [
      { shotId: 's1', candidate: { prompt: 'p1', modelId: 'm', parameters: { duration: 8 } } },
    ] } } }))
    fs.writeFileSync(path.join(runs, 'op-bad', 'run.json'), '{not json')
    const read = readRunJsons(dir)
    expect(read.unreadable).toEqual(['op-bad'])
    expect(planShotsFromRuns(read.runs).map((s) => [s.shotId, s.prompt, s.parameters.duration])).toEqual([['s1', 'p1', 8]])
  })
  it('画布概况只出人读的几列', () => {
    const dir = makeTempDir('param-eval-collect-canvas-')
    fs.mkdirSync(path.join(dir, '.nomi'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.nomi', 'project.json'), JSON.stringify({ payload: { generationCanvas: { nodes: [{ id: 'n1', kind: 'video', title: 't', prompt: 'p', status: 'idle', meta: { a: 1 } }] } } }))
    expect(readCanvasSummary(dir).nodes).toEqual([{ id: 'n1', kind: 'video', title: 't', prompt: 'p', status: 'idle', metaKeys: ['a'] }])
  })
})


describe('测试段与预演段取证', () => {
  it('测试话术只挂测试首调用、重试也从测试段重新算', () => {
    const calls = Array.from({ length: 4 }, (_, i) => ({ name: 'draft_shots', toolCallId: `c${i}`, isError: true, resultText: 'same error' }))
    const rows = taskTrajectory({ id: 'case', say: 'test instruction' }, calls, 2)
    expect(rows.map((r) => r.phase)).toEqual(['prelude', 'prelude', 'test', 'test'])
    expect(rows.map((r) => r.userSays)).toEqual([undefined, undefined, 'test instruction', undefined])
    expect(rows.map((r) => r.attempt)).toEqual([1, 2, 1, 2])
    expect(taskTrajectory({ id: 'case', say: 'test' }, [], 0)).toEqual([])
  })
})
