#!/usr/bin/env node
// Public IPC negative control, separate from the production user journey.
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { assertOutsideRepo } from './uiDriverOptions.mjs'
import { expect } from './_assert.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { laneDiskSnapshot, readLaneTranscripts } from './agent-lane-observer.mjs'

const output = process.env.NOMI_WALK_OUT || process.env.EVIDENCE_DIR
process.env.NOMI_WALK_OUT = output ? assertOutsideRepo(output) : makeTempDir('agent-single-shot-skill-boundary-')
process.env.EVIDENCE_DIR = process.env.NOMI_WALK_OUT
const walk = await createRuntimeWalk('single-shot-skill-boundary')
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId, projectRoot } = await walk.newProject()
  await expect.poll(() => readLaneTranscripts(projectRoot).length).toBe(1)
  const before = laneDiskSnapshot(projectRoot)
  const result = await win.evaluate((id) => window.nomiDesktop.agentLane.send({
    kind: 'single-shot', requestId: 'missing-installed-skill', projectId: id,
    featureKey: 'fixture-negative-control', prompt: 'No provider request is allowed.',
    context: { approvalPolicy: { mode: 'request' }, skillKey: 'fixture.nonexistent-installed-skill' },
  }), projectId)
  expect(result).toMatchObject({ ok: false, code: 'agent_skill_unavailable', diagnostic: 'agent_skill_unavailable' })
  expect(walk.fixture.requests).toHaveLength(0)
  expect(laneDiskSnapshot(projectRoot)).toEqual(before)
  walk.fixture.assertClean()
  walk.report.verified = ['explicit-missing-skill-is-rejected-before-provider-and-history']
} catch (error) { failure = error; process.exitCode = 1 }
finally { await walk.finish(failure) }
