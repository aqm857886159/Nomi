import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./settingsRoot', () => ({ getSettingsRoot: () => root }))

let root = ''
const roots: string[] = []
function freshRoot(): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-agent-approval-'))
  roots.push(root)
  return root
}

afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('主进程持有的权限档', () => {
  it('没写过 → 默认档（更常问的那一档），不是最松的那一档', async () => {
    freshRoot()
    const { readAgentApprovalPolicy } = await import('./agentApprovalPolicySettings')
    expect(readAgentApprovalPolicy()).toEqual({ mode: 'request' })
  })

  it('用户切档 → 落盘 → 下一次开项目 / 另一条路读到的是同一个值', async () => {
    freshRoot()
    const { readAgentApprovalPolicy, writeAgentApprovalPolicy, agentApprovalPolicySettingsPath } = await import('./agentApprovalPolicySettings')
    expect(writeAgentApprovalPolicy({ mode: 'direct' })).toEqual({ mode: 'direct' })
    expect(fs.existsSync(agentApprovalPolicySettingsPath())).toBe(true)
    expect(readAgentApprovalPolicy()).toEqual({ mode: 'direct' })
  })

  it('认不出的值回落到默认档（更常问），不是静默放松', async () => {
    freshRoot()
    const { readAgentApprovalPolicy, writeAgentApprovalPolicy, agentApprovalPolicySettingsPath } = await import('./agentApprovalPolicySettings')
    writeAgentApprovalPolicy({ mode: 'direct' })
    fs.writeFileSync(agentApprovalPolicySettingsPath(), JSON.stringify({ schemaVersion: 2, policy: { mode: '全自动无敌版' } }))
    expect(readAgentApprovalPolicy()).toEqual({ mode: 'request' })
  })

  it('盘上是裸的 { mode } 也读得出来（手改过的文件不整份丢掉）', async () => {
    freshRoot()
    const { readAgentApprovalPolicy, agentApprovalPolicySettingsPath } = await import('./agentApprovalPolicySettings')
    fs.mkdirSync(path.dirname(agentApprovalPolicySettingsPath()), { recursive: true })
    fs.writeFileSync(agentApprovalPolicySettingsPath(), JSON.stringify({ mode: 'request' }))
    expect(readAgentApprovalPolicy()).toEqual({ mode: 'request' })
  })

  it('盘上是旧版三档（schemaVersion 1，含旧「全自动」）→ 读到的是 request，不会悄悄变成直接生成', async () => {
    freshRoot()
    const { readAgentApprovalPolicy, agentApprovalPolicySettingsPath } = await import('./agentApprovalPolicySettings')
    fs.mkdirSync(path.dirname(agentApprovalPolicySettingsPath()), { recursive: true })
    for (const mode of ['step', 'safe-auto', 'project']) {
      fs.writeFileSync(agentApprovalPolicySettingsPath(), JSON.stringify({ schemaVersion: 1, policy: { mode, spend: 'confirm' } }))
      expect(readAgentApprovalPolicy()).toEqual({ mode: 'request' })
    }
  })

  it('权限档位没变时不触发 fsyncSync / 落盘；真改档位必写一次盘', async () => {
    freshRoot()
    const { writeAgentApprovalPolicy, readAgentApprovalPolicy, agentApprovalPolicySettingsPath } = await import('./agentApprovalPolicySettings')
    const filePath = agentApprovalPolicySettingsPath()
    const bakPath = filePath.replace(/\.json$/, '.bak.json')

    // 默认态（无文件 = request）下重复写入 request：0 次写盘（不创建文件、不留 .bak.json）
    expect(writeAgentApprovalPolicy({ mode: 'request' })).toEqual({ mode: 'request' })
    expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.existsSync(bakPath)).toBe(false)

    // 反例：真改档位（request -> direct），必须写一次盘
    expect(writeAgentApprovalPolicy({ mode: 'direct' })).toEqual({ mode: 'direct' })
    expect(fs.existsSync(filePath)).toBe(true)
    expect(readAgentApprovalPolicy()).toEqual({ mode: 'direct' })
    const afterFirstWrite = fs.statSync(filePath, { bigint: true })
    expect(fs.existsSync(bakPath)).toBe(false)

    // 连续发送消息重复传同一档位（direct -> direct）：0 次新增写盘（inode、mtimeNs 不变，且未轮转 .bak.json）
    expect(writeAgentApprovalPolicy({ mode: 'direct' })).toEqual({ mode: 'direct' })
    expect(writeAgentApprovalPolicy({ mode: 'direct' })).toEqual({ mode: 'direct' })
    const afterNoopWrites = fs.statSync(filePath, { bigint: true })
    expect(afterNoopWrites.ino).toBe(afterFirstWrite.ino)
    expect(afterNoopWrites.mtimeNs).toBe(afterFirstWrite.mtimeNs)
    expect(fs.existsSync(bakPath)).toBe(false)

    // 反例：再改回 request（direct -> request），必须再写一次盘（原子写换新 inode 并轮转 .bak.json）
    expect(writeAgentApprovalPolicy({ mode: 'request' })).toEqual({ mode: 'request' })
    const afterSecondWrite = fs.statSync(filePath, { bigint: true })
    expect(afterSecondWrite.ino).not.toBe(afterFirstWrite.ino)
    expect(fs.existsSync(bakPath)).toBe(true)
    expect(readAgentApprovalPolicy()).toEqual({ mode: 'request' })
  })
})
