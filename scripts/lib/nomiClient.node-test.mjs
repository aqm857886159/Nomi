import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { invoke, parseHeadlessHostResponse } from './nomiClient.mjs'

function assertStructuredFailure(error, code, nextAction) {
  assert.equal(error?.code, code)
  assert.equal(error?.errorCode, code)
  assert.equal(error?.nextAction, nextAction)
  assert.match(error?.message ?? '', new RegExp(code))
  assert.match(error?.message ?? '', new RegExp(nextAction))
  assert.doesNotMatch(error?.message ?? '', /\[object Object\]|private-provider-cause|\/Users\/alice/)
  return true
}

test('GUI RPC CLI preserves a structured canvas-read failure with one safe message', async () => {
  const capabilityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-cli-rpc-error-'))
  const previous = process.env.NOMI_CAPABILITY_DIR
  const nextAction = 'Retry the canvas read'
  const server = createServer((_request, response) => {
    response.writeHead(409, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        ok: false,
        error: {
          message: 'private-provider-cause /Users/alice/project',
          code: 'surface_port_stale',
          nextAction,
          capability: 'canvas.read',
        },
      }),
    )
  })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    fs.writeFileSync(path.join(capabilityDir, 'token'), 'test-token')
    fs.writeFileSync(
      path.join(capabilityDir, 'instance.json'),
      JSON.stringify({ pid: process.pid, port: address.port }),
    )
    process.env.NOMI_CAPABILITY_DIR = capabilityDir

    await assert.rejects(invoke('canvas.read', { projectId: 'p' }), (error) =>
      assertStructuredFailure(error, 'surface_port_stale', nextAction),
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
    if (previous === undefined) delete process.env.NOMI_CAPABILITY_DIR
    else process.env.NOMI_CAPABILITY_DIR = previous
    fs.rmSync(capabilityDir, { recursive: true, force: true })
  }
})

test('headless host CLI uses the same structured failure parser', () => {
  const nextAction = 'Open a new project session'
  const stdout = JSON.stringify({
    ok: false,
    error: {
      message: 'private-provider-cause /Users/alice/project',
      code: 'capability_authority_invalid',
      nextAction,
      capability: 'canvas.read',
    },
  })

  assert.throws(
    () => parseHeadlessHostResponse(stdout),
    (error) => assertStructuredFailure(error, 'capability_authority_invalid', nextAction),
  )
})

test('legacy string host errors keep their existing human message', () => {
  assert.throws(
    () => parseHeadlessHostResponse(JSON.stringify({ ok: false, error: '鉴权失败：token 无效' })),
    (error) => error?.message === '鉴权失败：token 无效',
  )
})
