import path from 'node:path'
import fs from 'node:fs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { repoRoot } from './_launchApp.mjs'

export async function createRecordedRelayWalk(name, options, origin) {
  const env = { ...options.env, NOMI_RELAY_RECORD_ORIGIN: new URL(origin).origin }
  const walk = await createRuntimeWalk(name, { ...options, env, mainRequire: [...(options.mainRequire ?? []), path.join(repoRoot, 'tests/ux/_relayVideoResponseRecording.cjs')] })
  // createRuntimeWalk reads this same env at start(), after the isolated output directory exists.
  env.NOMI_RELAY_RECORD_FILE = path.join(walk.outputDir, 'relay-responses.sanitized.jsonl')
  walk.report.responseRecording = { file: env.NOMI_RELAY_RECORD_FILE, format: 'schema-v1 allowlisted response projection; allowlisted request minimums and response shape; no raw bodies, headers, original identifiers, URLs or free text', coordinatorAction: 'review and copy sanitized responses into tests/relay-onboarding/fixtures after the authorized paid run' }
  return walk
}
export async function flushRelayRecording(app) {
  if (!app) return
  const result = await app.evaluate(() => globalThis[Symbol.for('nomi.relay.response-recording')]?.flush())
  if (!result || result.failed) throw new Error('Sanitized relay response recording did not complete')
}

export function readRelayRecordedRequests(walk) {
  const file = walk.report.responseRecording.file
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter((entry) => entry.kind === 'request') : []
}
