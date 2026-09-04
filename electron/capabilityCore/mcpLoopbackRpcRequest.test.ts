import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { appFetch } from '../appFetch'
import { createMcpConnectionContext } from './mcpConnectionContext'
import { createMcpLoopbackRpcRequest } from './mcpLoopbackRpcRequest'
import { CAPABILITY_DIR_ENV, ensureToken, signMcpClient } from './security'

const roots: string[] = []
const servers: http.Server[] = []

afterEach(async () => {
  delete process.env[CAPABILITY_DIR_ENV]
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  servers.push(server)
  return (server.address() as { port: number }).port
}

describe('MCP loopback RPC request boundary', () => {
  it('forwards an explicit document approval as a top-level RPC confirmation flag', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-loopback-document-confirm-'))
    roots.push(root)
    process.env[CAPABILITY_DIR_ENV] = path.join(root, 'capability')
    ensureToken()
    const proof = signMcpClient('codex')!
    const request = createMcpLoopbackRpcRequest({
      token: 'token',
      clientProof: proof,
      connection: createMcpConnectionContext({ client: 'codex', proof }),
      method: 'document.write',
      params: { projectId: 'project-1', operation: 'append', content: 'approved' },
      documentConfirmed: true,
      requestId: 'json-rpc-id-17',
    })

    expect(JSON.parse(String(request.body))).toMatchObject({ documentConfirmed: true, requestId: 'json-rpc-id-17' });
  });

  it.each([
    ['packaged launcher fetch', globalThis.fetch.bind(globalThis)],
    ['Electron stdio appFetch', appFetch],
  ] as const)('%s refuses redirects before any sensitive header reaches the second loopback target', async (_name, fetchImpl) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-loopback-redirect-'))
    roots.push(root)
    process.env[CAPABILITY_DIR_ENV] = path.join(root, 'capability')
    ensureToken()
    const proof = signMcpClient('codex')!
    const connection = createMcpConnectionContext({
      client: 'codex',
      proof,
      randomSecret: () => 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    })
    const targetRequests: http.IncomingHttpHeaders[] = []
    const targetPort = await listen(http.createServer((request, response) => {
      targetRequests.push({ ...request.headers })
      request.resume()
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true, result: {} }))
      })
    }))
    let sourceRequests = 0
    const sourcePort = await listen(http.createServer((request, response) => {
      sourceRequests += 1
      request.resume()
      request.on('end', () => {
        response.writeHead(307, { location: `http://127.0.0.1:${targetPort}/stolen` })
        response.end()
      })
    }))

    await expect(fetchImpl(
      `http://127.0.0.1:${sourcePort}/rpc`,
      createMcpLoopbackRpcRequest({
        token: 'loopback-bearer-token',
        clientProof: proof,
        connection,
        method: 'canvas.read',
        params: { projectId: 'project-1', leaseHandle: 'opaque-lease' },
      }),
    )).rejects.toBeInstanceOf(Error)

    expect(sourceRequests).toBe(1)
    expect(targetRequests).toEqual([])
    expect(targetRequests.flatMap((headers) => [
      headers['x-nomi-mcp-client-proof'],
      headers['x-nomi-mcp-connection-attestation'],
    ].filter(Boolean))).toEqual([])
  })
})
