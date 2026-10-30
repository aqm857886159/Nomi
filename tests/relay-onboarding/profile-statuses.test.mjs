import { URL } from 'node:url'
// Only profile vocabulary is asserted; the shared hard-evidence inference is unchanged.
import { expect, it } from 'vitest'
import fs from 'node:fs'
import { openAiVideoMode, NEWAPI_STATUS_MAPPING } from '../../electron/catalog/newapiTransport.ts'
import { resolveTaskStatus } from '../../electron/tasks/responseParsing.ts'
const documents = [
  { url: 'https://github.com/openai/openai-node/blob/master/src/resources/videos.ts', checkedAt: '2026-10-30', profile: 'openai-videos-v1', vocabulary: { queued: 'queued', in_progress: 'running', completed: 'succeeded', failed: 'failed' }, mapping: openAiVideoMode().statusMapping },
  // This page supplies lifecycle vocabulary, never evidence for selecting the legacy singular route.
  { url: 'https://doc.newapi.pro/api/openai-video/', checkedAt: '2026-10-30', profile: 'video-generations-json-v1', vocabulary: { processing: 'running', succeeded: 'succeeded', failed: 'failed' }, mapping: NEWAPI_STATUS_MAPPING },
]
for (const doc of documents) {
  it(`${doc.profile}: every documented lifecycle word is explicitly covered (${doc.url})`, () => {
    for (const [word, normalized] of Object.entries(doc.vocabulary)) {
      expect(doc.mapping[normalized], `documented ${word}`).toContain(word)
      expect(resolveTaskStatus({ status: word }, null, doc.mapping, [])).toEqual({ status: normalized, unrecognizedStatus: '' })
    }
  })
  it(`${doc.profile}: unknown without output or error retains the existing bounded-tolerance marker`, () => {
    expect(resolveTaskStatus({ status: 'future_doc_verb' }, null, doc.mapping, [])).toEqual({ status: 'queued', unrecognizedStatus: 'future_doc_verb' })
  })
}

const fixtures = new URL('./fixtures/relay-profile-responses/', import.meta.url)
for (const file of fs.readdirSync(fixtures).filter((name) => name.endsWith('.json'))) {
  const packet = JSON.parse(fs.readFileSync(new URL(file, fixtures), 'utf8'))
  it(`reviewed provider recording: ${file}`, () => {
    const doc = documents.find((item) => item.profile === packet.profile)
    expect(Boolean(doc) || packet.profile === 'declaration').toBe(true)
    const mapping = doc?.mapping ?? packet.declaration?.statusMapping
    expect(mapping).toBeTruthy()
    expect(packet.sourceUrl).toMatch(/^https:\/\//)
    expect(Number.isFinite(Date.parse(packet.recordedAt))).toBe(true)
    expect(packet.samples.length).toBeGreaterThan(0)
    for (const sample of packet.samples) {
      expect(resolveTaskStatus(sample.response, packet.declaration?.responseMapping ?? null, mapping, [])).toEqual({ status: sample.expectedStatus, unrecognizedStatus: sample.expectedUnknown })
    }
  })
}
