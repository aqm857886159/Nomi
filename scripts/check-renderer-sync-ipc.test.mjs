import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decide, scanSyncIpc } from './check-renderer-sync-ipc.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts', 'renderer-sync-ipc-baseline.json'), 'utf8')).channels

describe('渲染进程同步 IPC 棘轮', () => {
  it('仓库现状与基线一致', () => {
    expect(decide(scanSyncIpc(), baseline)).toEqual([])
  })

  it('目录读（渠道 mapping / 模型 / 供应商 / 健康度）不再是同步 IPC——点卡、开设置、Agent 面板都读它们', () => {
    const readChannels = ['nomi:model-catalog:mappings:list', 'nomi:model-catalog:models:list', 'nomi:model-catalog:vendors:list', 'nomi:model-catalog:health']
    expect(scanSyncIpc().filter((entry) => readChannels.includes(entry.channel))).toEqual([])
  })

  it('新增一条同步通道 → 红', () => {
    const errors = decide([...baseline, { file: 'electron/preload/x.ts', channel: 'nomi:new:sync' }], baseline)
    expect(errors.join('\n')).toContain('新增的同步 IPC：electron/preload/x.ts :: nomi:new:sync')
  })

  it('基线里的一条已经删了却没从基线删 → 红（只减不增，减了要记账）', () => {
    const errors = decide(baseline.slice(1), baseline)
    expect(errors.join('\n')).toContain('已经不在了')
  })

  it('频道名不是字面量 → 红（认不出是哪一条，就没法冻结）', () => {
    const errors = decide([{ file: 'electron/preload/x.ts', unnamed: true, expression: 'channel' }], [])
    expect(errors.join('\n')).toContain('不是字面量')
  })
})
