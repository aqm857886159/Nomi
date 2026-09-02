import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertFullCanvasShardPartition,
  CRITICAL_CANVAS_SCENARIOS,
  DEFAULT_CANVAS_SCENARIO_TIMEOUT_MS,
  FULL_CANVAS_SCENARIOS,
  FULL_CANVAS_SHARDS,
  parseCanvasShard,
  parseCanvasSuiteArgv,
  PERFORMANCE_CANVAS_SCENARIOS,
  PERFORMANCE_CANVAS_SCENARIO_TIMEOUT_MS,
  runCanvasScenario,
  scenariosForProfile,
} from './canvas-real-suite.mjs'

describe('real canvas acceptance suite', () => {
  it('keeps every critical scenario in the full profile exactly once', () => {
    const criticalIds = CRITICAL_CANVAS_SCENARIOS.map((scenario) => scenario.id)
    const fullIds = FULL_CANVAS_SCENARIOS.map((scenario) => scenario.id)

    expect(new Set(criticalIds).size).toBe(criticalIds.length)
    expect(new Set(fullIds).size).toBe(fullIds.length)
    expect(fullIds.slice(0, criticalIds.length)).toEqual(criticalIds)
  })

  it('references executable repository test files', () => {
    for (const scenario of [...FULL_CANVAS_SCENARIOS, ...PERFORMANCE_CANVAS_SCENARIOS]) {
      expect(fs.existsSync(path.resolve(scenario.script)), scenario.script).toBe(true)
    }
  })

  it('fails closed for unknown profiles', () => {
    expect(() => scenariosForProfile('typo')).toThrow('unknown canvas suite profile')
  })

  it('partitions every full scenario into exactly one CI shard, in canonical order', () => {
    expect(() => assertFullCanvasShardPartition()).not.toThrow()

    const fullIds = FULL_CANVAS_SCENARIOS.map((scenario) => scenario.id)
    const shardedIds = FULL_CANVAS_SHARDS.map((_, index) =>
      scenariosForProfile('full', { shard: { index: index + 1, total: FULL_CANVAS_SHARDS.length } })
        .map((scenario) => scenario.id),
    )

    expect(shardedIds.flat().toSorted()).toEqual(fullIds.toSorted())
    for (const ids of shardedIds) {
      expect(ids.length).toBeGreaterThan(0)
      expect(fullIds.filter((id) => ids.includes(id))).toEqual(ids)
    }
  })

  it('fails closed when a full scenario is left out of the shard partition', () => {
    const drifted = [...FULL_CANVAS_SCENARIOS, { id: 'brand-new-walkthrough', script: 'tests/ux/new.walk.mjs' }]
    expect(() => assertFullCanvasShardPartition(drifted)).toThrow(/missing=\[brand-new-walkthrough\]/)
    expect(() => assertFullCanvasShardPartition(FULL_CANVAS_SCENARIOS, [['gestures'], ['gestures']])).toThrow(/duplicated=\[gestures\]/)
    expect(() => assertFullCanvasShardPartition(FULL_CANVAS_SCENARIOS, FULL_CANVAS_SHARDS.map((ids) => [...ids, 'ghost']))).toThrow(/unknown=\[ghost/)
  })

  it('parses only well-formed shard specs matching the declared shard count', () => {
    expect(parseCanvasShard('1/2')).toEqual({ index: 1, total: 2 })
    expect(parseCanvasShard('2/2')).toEqual({ index: 2, total: 2 })
    expect(() => parseCanvasShard('0/2')).toThrow('out of range')
    expect(() => parseCanvasShard('3/2')).toThrow('out of range')
    expect(() => parseCanvasShard('1/3')).toThrow('does not match FULL_CANVAS_SHARDS')
    expect(() => parseCanvasShard('half')).toThrow('invalid canvas shard spec')
    expect(() => parseCanvasShard(undefined)).toThrow('invalid canvas shard spec')
  })

  it('rejects sharding for non-full profiles and unknown CLI arguments', () => {
    expect(() => scenariosForProfile('critical', { shard: { index: 1, total: 2 } })).toThrow('only supported for the full profile')
    expect(() => scenariosForProfile('performance', { shard: { index: 1, total: 2 } })).toThrow('only supported for the full profile')
    expect(parseCanvasSuiteArgv(['full', '--shard', '1/2'])).toEqual({ profile: 'full', shard: { index: 1, total: 2 } })
    // pnpm 会把 `--` 分隔符原样转发给脚本（CI 实际到达的 argv 形状），npm 则吃掉它；两种都必须可解析。
    expect(parseCanvasSuiteArgv(['full', '--', '--shard', '2/2'])).toEqual({ profile: 'full', shard: { index: 2, total: 2 } })
    expect(parseCanvasSuiteArgv(['critical'])).toEqual({ profile: 'critical', shard: null })
    expect(() => parseCanvasSuiteArgv(['full', '--shards', '1/2'])).toThrow('unknown canvas suite argument')
  })

  it('keeps performance separate from functional full acceptance with its own bounded budget', () => {
    expect(FULL_CANVAS_SCENARIOS.map((scenario) => scenario.id)).not.toContain('medium-canvas-performance')
    expect(scenariosForProfile('performance')).toBe(PERFORMANCE_CANVAS_SCENARIOS)
    const performance = PERFORMANCE_CANVAS_SCENARIOS.find((scenario) => scenario.id === 'medium-canvas-performance')
    expect(performance?.args?.[0]).toBe('validation-gate')
    expect(performance?.timeoutMs).toBe(PERFORMANCE_CANVAS_SCENARIO_TIMEOUT_MS)
    expect(PERFORMANCE_CANVAS_SCENARIO_TIMEOUT_MS).toBeGreaterThan(DEFAULT_CANVAS_SCENARIO_TIMEOUT_MS)
  })

  it('terminates and reports a canvas scenario that exceeds its hard timeout', () => {
    let launch
    const result = runCanvasScenario(
      { id: 'stuck', script: 'tests/ux/stuck.walk.mjs' },
      {
        cwd: '/tmp/nomi-suite',
        env: { NOMI_E2E: '1' },
        spawnProcess: (executable, args, options) => {
          launch = { executable, args, options }
          return {
            status: null,
            signal: 'SIGKILL',
            error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }),
          }
        },
      },
    )

    expect(launch).toMatchObject({
      executable: process.execPath,
      args: ['tests/ux/stuck.walk.mjs'],
      options: {
        timeout: DEFAULT_CANVAS_SCENARIO_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      },
    })
    expect(result).toMatchObject({
      exitCode: 1,
      signal: 'SIGKILL',
      timedOut: true,
      timeoutMs: DEFAULT_CANVAS_SCENARIO_TIMEOUT_MS,
    })
  })

  it('persists each child transcript and an actionable failure summary', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-canvas-suite-'))
    const outputDir = path.join(cwd, 'outputs/canvas-acceptance/critical')
    const stdout = { write: () => true }
    const stderr = { write: () => true }
    const result = runCanvasScenario(
      { id: 'gestures', script: 'tests/ux/canvas-drag-pan-gestures.walk.mjs' },
      {
        cwd,
        outputDir,
        stdoutWriter: stdout,
        stderrWriter: stderr,
        spawnProcess: () => ({
          status: 1,
          signal: null,
          stdout: 'fixture setup started\n',
          stderr: 'Error: System secure storage is unavailable\n  at fixture setup\n',
        }),
      },
    )

    expect(result).toMatchObject({
      exitCode: 1,
      logPath: 'outputs/canvas-acceptance/critical/gestures.log',
    })
    expect(result.failureSummary).toContain('System secure storage is unavailable')
    const transcript = fs.readFileSync(path.join(cwd, result.logPath), 'utf8')
    expect(transcript).toContain('[stdout]\nfixture setup started')
    expect(transcript).toContain('[stderr]\nError: System secure storage is unavailable')
  })
})
