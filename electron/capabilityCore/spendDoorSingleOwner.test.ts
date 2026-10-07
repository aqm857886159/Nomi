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

// 2026-09-21：测试不许读写用户真实目录。这份文件此前经默认路径读到了**用户本人的**
// `~/.nomi/capability-core`（token / 签名密钥 / 接入会话 / handoff 队列都住那里）——
// 读到的是真人数据，写下去就是改真人数据，而且一台机器一个结果：`mcpOnboardingLoopback`
// 就是这么在这台机器上红、在别处绿的。给它一个本轮独有的空目录。
const capabilityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-spend-door-cap-"));
process.env.NOMI_CAPABILITY_DIR = capabilityRoot;

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

  it('网关没有付费口：磁盘 / 混合 / 渲染层网关都不再有 confirmSpend（设了 NOMI_LOOP_SPEND_OK=1 也一样）', async () => {
    process.env.NOMI_LOOP_SPEND_OK = '1'
    const { createDiskGateway, createHybridGateway, createRendererGateway } = await import('./gateway')
    for (const gateway of [createDiskGateway('p1'), createHybridGateway('p1'), createRendererGateway('p1')]) {
      expect('confirmSpend' in gateway).toBe(false)
    }
  })

  it('网关模块不再导出「客户端自报即发放」的包装器', async () => {
    const gateway = await import('./gateway')
    expect(Object.keys(gateway)).not.toContain('withPreApprovedSpend')
  })

  it('loopback RPC 线上没有付费自报位（spendConfirmed 不再是协议的一部分）', async () => {
    const { createMcpLoopbackRpcRequest } = await import('./mcpLoopbackRpcRequest')
    const { createMcpConnectionContext } = await import('./mcpConnectionContext')
    const { ensureToken, signMcpClient } = await import('./security')
    // 本机令牌由这一轮自己铸（写进上面那个空目录）。它此前是从**用户真实的**
    // `~/.nomi/capability-core/token` 读来的——于是这条断言在用户装过 Nomi 的机器上绿、
    // 在干净机器上直接抛「A verified MCP client connection is required」。
    // 判的是「线上有没有付费自报位」，与令牌是谁的无关，所以自备一把才是它真正要的处境。
    ensureToken()
    const connection = createMcpConnectionContext({
      client: 'codex',
      proof: signMcpClient('codex')!,
      randomSecret: () => 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    })
    const request = createMcpLoopbackRpcRequest({
      token: 't',
      clientProof: 'proof',
      connection,
      // legacy `canvas.addNodes` 已于 2026-09-21 删除；这里换成还活着的画布写路由，
      // 断言的是线上没有付费自报位，与方法名无关。
      method: 'canvas.write',
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
