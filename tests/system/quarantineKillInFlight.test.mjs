// 隔离区写到一半被 kill -9：不许留下半截的隔离文件，同一份内容再写一次必须写出完整文件（2026-11-13 独立验收第 3 条 (a)）。
// 隔离区用原子写（写临时文件 → 改名）；把它换回直接写，这条会红。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { afterAll, describe, expect, it } from 'vitest'
import { makeTempDir } from '../../scripts/_test-temp.mjs'

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/quarantine-kill-inflight.mjs')
const roots = []
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }) })
const run = (root, phase) => spawnSync(process.execPath, ['--import', 'tsx', FIXTURE, JSON.stringify({ root, phase })], {
  encoding: 'utf8', timeout: 60_000, env: { ...process.env, VITEST: undefined, VITEST_WORKER_ID: undefined },
})
const visibleFiles = (root) => {
  const dir = path.join(root, '.nomi', 'quarantine')
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => !name.startsWith('.')) : []
}

describe('a process killed with SIGKILL while writing a quarantine file', () => {
  it('leaves no half file, and the same content written again lands complete', () => {
    const root = fs.realpathSync(makeTempDir('nomi-quarantine-kill-'))
    roots.push(root)
    const killed = run(root, 'kill')
    expect(killed.signal).toBe('SIGKILL') // 防空转：真的在写的中途被杀了
    for (const name of visibleFiles(root)) {
      expect(() => JSON.parse(fs.readFileSync(path.join(root, '.nomi', 'quarantine', name), 'utf8'))).not.toThrow()
    }
    const again = run(root, 'write')
    expect(again.status).toBe(0)
    const names = visibleFiles(root)
    expect(names).toHaveLength(1)
    const body = JSON.parse(fs.readFileSync(path.join(root, '.nomi', 'quarantine', names[0]), 'utf8'))
    expect(body.raw.prompt).toHaveLength(1_600_000)
  }, 60_000)
})
