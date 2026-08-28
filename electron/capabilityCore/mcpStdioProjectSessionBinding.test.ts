import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createMcpGenerationPolicy } from './mcpGenerationPolicy'
import { createProductionMcpStdioProjectSessionBinding } from './mcpStdioProjectSessionBinding'
import {
  MCP_CLIENT_ENV,
  MCP_CLIENT_PROOF_ENV,
  ensureToken,
  signMcpClient,
} from './security'

const tempDirs: string[] = []
const previousCapabilityDir = process.env.NOMI_CAPABILITY_DIR
const previousClient = process.env[MCP_CLIENT_ENV]
const previousProof = process.env[MCP_CLIENT_PROOF_ENV]

afterEach(() => {
  if (previousCapabilityDir === undefined) delete process.env.NOMI_CAPABILITY_DIR
  else process.env.NOMI_CAPABILITY_DIR = previousCapabilityDir
  if (previousClient === undefined) delete process.env[MCP_CLIENT_ENV]
  else process.env[MCP_CLIENT_ENV] = previousClient
  if (previousProof === undefined) delete process.env[MCP_CLIENT_PROOF_ENV]
  else process.env[MCP_CLIENT_PROOF_ENV] = previousProof
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('production MCP stdio project-session binding', () => {
  it('assembles the empty-args stdio path from verified env proof without optional lease seams', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-stdio-binding-'))
    tempDirs.push(dir)
    process.env.NOMI_CAPABILITY_DIR = dir
    process.env[MCP_CLIENT_ENV] = 'codex'
    ensureToken()
    process.env[MCP_CLIENT_PROOF_ENV] = signMcpClient('codex')!

    const binding = createProductionMcpStdioProjectSessionBinding(
      createMcpGenerationPolicy({ env: {} }),
    )

    expect(binding.connection).toMatchObject({
      authenticatedClient: 'codex',
      principal: 'mcp:codex',
      sessionId: expect.stringMatching(/^mcp-session:/),
      connectionNonce: expect.any(String),
    })
    expect(Object.isFrozen(binding)).toBe(true)
    await expect(binding.authority.open(
      { bootstrap: { mode: 'current_project' } },
      binding.connection,
    )).rejects.toThrow(/open a project/i)
  })
})
