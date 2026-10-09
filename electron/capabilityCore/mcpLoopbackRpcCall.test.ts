import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMcpConnectionContext } from './mcpConnectionContext'
import { callMcpLoopbackRpc, mcpRpcTimeoutMessage, mcpRequestMayHaveRunMessage } from './mcpLoopbackRpcCall'
import { CAPABILITY_DIR_ENV, ensureToken, signMcpClient } from './security'

const roots: string[] = []

afterEach(() => {
  vi.stubEnv(CAPABILITY_DIR_ENV, undefined)
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function connection() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-loopback-call-'))
  roots.push(root)
  vi.stubEnv(CAPABILITY_DIR_ENV, path.join(root, 'capability'))
  ensureToken()
  const proof = signMcpClient('codex')!
  return { proof, connection: createMcpConnectionContext({ client: 'codex', proof }) }
}

function capturingFetch(captured: Array<{ url: string; init: RequestInit }>): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify({ ok: true, result: { done: true } }), { status: 200 })
  }) as typeof fetch
}

describe('shared MCP loopback RPC call (both launchers go through it)', () => {
  it('forwards planConfirmed AND documentConfirmed, so a user-approved document.write is not 403ed', async () => {
    const identity = connection()
    const captured: Array<{ url: string; init: RequestInit }> = []
    const result = await callMcpLoopbackRpc({
      instance: { port: 4242, token: 'tok' },
      fetchImpl: capturingFetch(captured),
      clientProof: identity.proof,
      connection: identity.connection,
      method: 'document.write',
      params: { projectId: 'p1', operation: 'append', content: 'x' },
      options: { planConfirmed: true, documentConfirmed: true },
    })
    expect(result).toEqual({ done: true })
    expect(captured[0].url).toBe('http://127.0.0.1:4242/rpc')
    expect(JSON.parse(String(captured[0].init.body))).toEqual({
      method: 'document.write',
      params: { projectId: 'p1', operation: 'append', content: 'x' },
      planConfirmed: true,
      documentConfirmed: true,
    })
  })

  it('builds a byte-identical request regardless of which fetch the host injects (appFetch vs native)', async () => {
    const identity = connection()
    const viaNative: Array<{ url: string; init: RequestInit }> = []
    const viaApp: Array<{ url: string; init: RequestInit }> = []
    const base = {
      instance: { port: 1, token: 'tok' },
      clientProof: identity.proof,
      connection: identity.connection,
      method: 'canvas.write',
      params: { a: 1 },
      options: { planConfirmed: true, documentConfirmed: false },
    }
    await callMcpLoopbackRpc({ ...base, fetchImpl: capturingFetch(viaNative) })
    await callMcpLoopbackRpc({ ...base, fetchImpl: capturingFetch(viaApp) })
    const strip = (entry: { url: string; init: RequestInit }) => ({ url: entry.url, headers: entry.init.headers, body: entry.init.body, redirect: entry.init.redirect })
    expect(strip(viaNative[0])).toEqual(strip(viaApp[0]))
  })

  it('has one timeout message (zh) for both launchers', () => {
    expect(mcpRpcTimeoutMessage(360_000)).toContain('360s')
  })

  it('structure guard: neither launcher builds its own RPC request or calls fetch directly', () => {
    for (const file of ['mcpNodeLauncher.ts', 'mcpStdioServer.ts']) {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
      expect(source, file).toContain('callMcpLoopbackRpc(')
      expect(source, file).not.toContain('createMcpLoopbackRpcRequest(')
      expect(source, file).not.toMatch(/\b(?:await\s+)?(?:appFetch|fetch)\(`http:\/\/127\.0\.0\.1/)
    }
  })

  const failing = (cause: Record<string, unknown>): typeof fetch => (async () => {
    throw new TypeError("fetch failed", { cause: Object.assign(new Error(String(cause.message ?? "socket")), cause) })
  }) as typeof fetch
  const callWith = (fetchImpl: typeof fetch) => {
    const identity = connection()
    return callMcpLoopbackRpc({
      instance: { port: 4242, token: "tok" }, fetchImpl, clientProof: identity.proof, connection: identity.connection,
      method: "canvas.write", params: {},
    })
  }

  it("says the request may already have run when Nomi drops the connection after delivery", async () => {
    const error = await callWith(failing({ code: "UND_ERR_SOCKET", message: "other side closed" })).catch((e: Error) => e)
    expect((error as Error).message).toBe(mcpRequestMayHaveRunMessage("fetch failed"))
    expect((error as Error).message).toContain("nomi_read")
    expect((error as Error).message).toContain("可能已被 Nomi 执行")
  })

  it("keeps the plain error when the request provably never left (port refused)", async () => {
    const error = await callWith(failing({ code: "ECONNREFUSED", syscall: "connect" })).catch((e: Error) => e)
    expect((error as Error).message).toBe("fetch failed")
  })
})
