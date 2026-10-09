import { makeTempDirAsync } from '../../../scripts/_test-temp.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { captureScenarioFailure } from './failureDiagnostics.mjs'

afterEach(() => vi.restoreAllMocks())

it('persists the complete assertion and DOM counts even when the screenshot fails', async () => {
  const directory = await makeTempDirAsync('canvas-failure-')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const message = 'expect(locator).toHaveCount(expected) failed\nLocator: [data-process-static-grid]\nExpected: 8\nReceived: 4\nCall log:\n  retry'
  try {
    const counts = { fxCanvas: 0, staticShells: 4, nodes: 8 }
    const result = await captureScenarioFailure({
      evaluate: async () => counts,
      screenshot: async () => { throw new Error('window closed') },
    }, { directory, id: 'warmup', error: new Error(message) })
    expect(result.message).toBe(message)
    expect(result.counts).toEqual(counts)
    expect(result.captureErrors).toEqual(['Error: window closed'])
    expect(JSON.parse(await fs.readFile(path.join(directory, 'warmup.json'), 'utf8'))).toEqual(result)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

it('still captures a screenshot when the DOM evaluation fails', async () => {
  const directory = await makeTempDirAsync('canvas-failure-')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const screenshot = vi.fn(async () => {})
  try {
    const result = await captureScenarioFailure({
      evaluate: async () => { throw new Error('evaluation unavailable') }, screenshot,
    }, { directory, id: 'sample', error: new Error('original failure') })
    expect(result.message).toBe('original failure')
    expect(result.captureErrors).toEqual(['Error: evaluation unavailable'])
    expect(screenshot).toHaveBeenCalledWith({ path: path.join(directory, 'sample.png'), timeout: 10_000 })
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
