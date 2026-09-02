// J4 packaged durability smoke: stop the real MCP process and reopen the same isolated session.
// This is deliberately no-spend. Live provider restart/upgrade evidence belongs in the release manifest.
import fs from 'node:fs'
import {
  assert,
  assertNoCredentialMaterial,
  makeIsolatedRoot,
  parseToolResult,
  spawnModelIntegrationMcp,
} from './_modelIntegrationHarness.mjs'

async function run() {
  const dirs = makeIsolatedRoot('nomi-model-integration-packaged-')
  let first = null
  let second = null
  try {
    first = spawnModelIntegrationMcp({ dirs, client: 'codex', signed: true })
    await first.initialize()
    const firstDraft = parseToolResult(
      await first.callTool('nomi_integration', {
        action: 'begin',
        kind: 'http-api-provider',
        name: 'Packaged restart draft',
        baseUrl: 'https://example.invalid/v1',
        authType: 'bearer',
        clientRequestId: 'j4-restart-draft',
      }),
    )
    assert(
      !firstDraft.isError && typeof firstDraft.json?.id === 'string',
      'packaged process creates the first durable draft',
    )
    const sessionId = firstDraft.json.id
    const revision = firstDraft.json.revision
    const duplicate = parseToolResult(
      await first.callTool('nomi_integration', {
        action: 'begin',
        kind: 'http-api-provider',
        name: 'Packaged restart draft',
        baseUrl: 'https://example.invalid/v1',
        authType: 'bearer',
        clientRequestId: 'j4-restart-draft',
      }),
    )
    assert(duplicate.json?.id === sessionId, 'same clientRequestId is idempotent before process restart')
    assert(duplicate.json?.revision === revision, 'idempotent begin does not advance the session revision')
    assertNoCredentialMaterial(firstDraft.json, 'pre-restart draft')
    await first.terminate()

    second = spawnModelIntegrationMcp({ dirs, client: 'codex', signed: true, runtime: first.runtime })
    await second.initialize()
    const afterRestart = parseToolResult(await second.callTool('nomi_read', { target: 'integration', sessionId }))
    assert(!afterRestart.isError && afterRestart.json?.id === sessionId, 'fresh MCP process reads the same session')
    assert(afterRestart.json?.revision === revision, 'fresh-process readback preserves revision')
    assert(afterRestart.json?.stage === 'needs_credential', 'fresh-process readback preserves unverified stage')
    assert(afterRestart.json?.credentialStatus === 'missing', 'fresh-process readback does not invent a credential')
    assertNoCredentialMaterial(afterRestart.json, 'post-restart session')
    const files = []
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = `${directory}/${entry.name}`
        if (entry.isDirectory()) walk(full)
        else files.push(full)
      }
    }
    walk(dirs.settingsDir)
    for (const file of files) assertNoCredentialMaterial(fs.readFileSync(file, 'utf8'), `persisted ${file}`)
    console.log(
      `MODEL INTEGRATION PACKAGED PASS: session ${sessionId} read after stop/restart; createRequests=0; credentialBytes=0`,
    )
  } finally {
    await first?.terminate().catch(() => undefined)
    await second?.terminate().catch(() => undefined)
    fs.rmSync(dirs.tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
