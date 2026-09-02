// J0: prove that an external agent can use the installed MCP surface from an empty cwd.
// The harness never reads Catalog files or source paths; it only sees tools/resources over stdio.
import fs from 'node:fs'
import {
  assert,
  assertNoCredentialMaterial,
  makeIsolatedRoot,
  parseToolResult,
  spawnModelIntegrationMcp,
} from './_modelIntegrationHarness.mjs'

// 面收敛（surface-16-collapse）：接入状态机 10 工具塌成 nomi_integration（9 写 action）+ nomi_read（target=integration）。
const REQUIRED_TOOLS = ['nomi_integration', 'nomi_read']

async function inspectPublicSurface(client, label) {
  await client.initialize()
  const tools = (await client.rpc('tools/list')).result?.tools || []
  const names = new Set(tools.map((tool) => tool.name))
  for (const name of REQUIRED_TOOLS) assert(names.has(name), `${label} tools/list includes ${name}`)
  assert(names.size === tools.length, `${label} tools/list has unique names`)
  const resources = (await client.rpc('resources/list')).result?.resources || []
  // Host cutover content-addresses skill resources (nomi-skill://<dir>/<version>/<hash>): prefix-match + read via uri.
  const skill = resources.find((resource) => resource.uri.startsWith('nomi-skill://model-integration/'))
  assert(skill, `${label} exposes model-integration Skill resource when resources are supported`)
  const body = (await client.rpc('resources/read', { uri: skill.uri })).result?.contents?.[0]?.text || ''
  assert(
    body.includes('nomi_integration') && body.includes('ComfyUI'),
    `${label} Skill is progressively readable`,
  )
  return { tools: tools.length, resources: resources.length, skillChars: body.length }
}

async function run() {
  const dirs = makeIsolatedRoot('nomi-model-integration-no-repo-')
  // Never print or persist the actual temporary directory. The external agent
  // only needs the fact that its cwd is isolated and has no repository access.
  const runtimeInfo = { packaged: false, sourceAccess: 'denied', cwd: 'isolated-temp-root' }
  let signed = null
  let unsigned = null
  try {
    signed = spawnModelIntegrationMcp({ dirs, client: 'codex', signed: true })
    const publicEvidence = await inspectPublicSurface(signed, 'signed codex')
    const begin = parseToolResult(
      await signed.callTool('nomi_integration', {
        action: 'begin',
        kind: 'http-api-provider',
        name: 'No-repository public draft',
        baseUrl: 'https://example.invalid/v1',
        docs: 'https://example.invalid/docs',
        authType: 'bearer',
        clientRequestId: 'j0-no-repo-draft',
      }),
    )
    assert(
      !begin.isError && typeof begin.json?.id === 'string',
      'signed agent can create a durable draft from an empty directory',
    )
    assert(
      begin.json.stage === 'needs_credential' && begin.json.credentialStatus === 'missing',
      'draft is not advertised as verified',
    )
    assert(begin.json.ownerClientId === 'codex', 'draft is bound to the signed client identity')
    assertNoCredentialMaterial(begin.json, 'signed draft')
    runtimeInfo.packaged = Boolean(signed.runtime.packaged)
    // M1 round-2 (0b6441c6) hardened the boundary: an UNVERIFIED client is refused at TRANSPORT
    // startup (mcpStdioProjectSessionBinding) — no tools/list, no session, nothing. Assert that
    // fail-closed refusal instead of the pre-cutover "read-only public surface" behavior.
    unsigned = spawnModelIntegrationMcp({ dirs, client: 'generic', signed: false, runtime: signed.runtime })
    const refusal = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ exited: false }), 20_000)
      unsigned.child.on('exit', (code) => { clearTimeout(timer); resolve({ exited: true, code }) })
    })
    assert(refusal.exited && refusal.code === 1, 'unsigned generic host is refused at transport startup (fail-closed)')
    assert(
      unsigned.stderr().some((line) => line.includes('verified MCP client connection is required')),
      'refusal names the verified-client requirement without leaking anything else',
    )
    const manifest = {
      schemaVersion: 1,
      journey: 'J0',
      status: 'pass',
      sourceAccess: 'denied',
      isolatedCwd: 'isolated-temp-root',
      runtime: runtimeInfo,
      signed: publicEvidence,
      unsigned: { transportRefused: true, writeRejected: true },
      providerRequests: 0,
      credentialBytesInResults: 0,
    }
    assertNoCredentialMaterial(manifest, 'J0 manifest')
    console.log(`MODEL INTEGRATION J0 PASS: ${JSON.stringify(manifest)}`)
  } finally {
    await signed?.terminate().catch(() => undefined)
    await unsigned?.terminate().catch(() => undefined)
    fs.rmSync(dirs.tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
