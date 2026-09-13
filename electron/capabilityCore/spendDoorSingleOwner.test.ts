// 付费放行只有一个 owner：主进程收据门（productionRunApprovalReceipt.createGateApprovalOwner）。
//
// 这条测试守的不变量：**没有主进程自己能背书的人证，任何 MCP 路径都拿不到付费授权**。
// 历史上第二扇门（gateway.withPreApprovedSpend / createDiskGateway 的 NOMI_LOOP_SPEND_OK 分支）
// 凭「客户端自报 accept」或「本进程 env」直接铸 spendGrant——等于把授权判据交给了调用方，
// 而调用方的资格只是「能读 ~/.nomi/capability-core/token」。删门后这里钉死它不许长回来。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockedDocumentsRoot = ''
let mockedUserDataRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'documents' ? mockedDocumentsRoot : mockedUserDataRoot),
    getAppPath: () => process.cwd(),
  },
}))

const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(root: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full))
      continue
    }
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('付费放行单一 owner（删掉客户端自报的第二扇门）', () => {
  const tempRoots: string[] = []

  beforeEach(() => {
    mockedDocumentsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-spend-door-docs-'))
    mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-spend-door-data-'))
    tempRoots.push(mockedDocumentsRoot, mockedUserDataRoot)
    delete process.env.NOMI_LOOP_SPEND_OK
  })

  afterEach(() => {
    delete process.env.NOMI_LOOP_SPEND_OK
    for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('headless 磁盘网关：设了 NOMI_LOOP_SPEND_OK=1 也不发放付费授权', async () => {
    process.env.NOMI_LOOP_SPEND_OK = '1'
    const { createDiskGateway } = await import('./gateway')
    const granted = await createDiskGateway('p1').confirmSpend({
      projectId: 'p1',
      nodeId: 'n1',
      intent: 'image',
      vendor: 'v',
      modelKey: 'm',
      prompt: 'robot',
    })
    expect(granted).toBeNull()
  })

  it('网关模块不再导出「客户端自报即发放」的包装器', async () => {
    const gateway = await import('./gateway')
    expect(Object.keys(gateway)).not.toContain('withPreApprovedSpend')
  })

  it('loopback RPC 线上没有付费自报位（spendConfirmed 不再是协议的一部分）', async () => {
    const { createMcpLoopbackRpcRequest } = await import('./mcpLoopbackRpcRequest')
    const { createMcpConnectionContext } = await import('./mcpConnectionContext')
    const { signMcpClient } = await import('./security')
    const connection = createMcpConnectionContext({
      client: 'codex',
      proof: signMcpClient('codex')!,
      randomSecret: () => 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    })
    const request = createMcpLoopbackRpcRequest({
      token: 't',
      clientProof: 'proof',
      connection,
      method: 'canvas.addNodes',
      params: {},
      // 旧协议位：即便调用方硬塞，也不许出现在线上。
      ...({ spendConfirmed: true } as Record<string, unknown>),
    })
    const body = JSON.parse(String(request.body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('spendConfirmed')
  })

  it('主进程源码里没有第二条发放路径（env 逃生口 / 预批包装器都不许回来）', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(electronRoot)) {
      if (file.endsWith(path.join('capabilityCore', 'spendDoorSingleOwner.test.ts'))) continue
      const text = fs.readFileSync(file, 'utf8')
      if (text.includes('NOMI_LOOP_SPEND_OK')) offenders.push(`${path.relative(electronRoot, file)}: NOMI_LOOP_SPEND_OK`)
      if (text.includes('withPreApprovedSpend')) offenders.push(`${path.relative(electronRoot, file)}: withPreApprovedSpend`)
    }
    expect(offenders).toEqual([])
  })
})
