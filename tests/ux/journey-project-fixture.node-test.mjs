import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { seedFinishedJourneyProject } from './fixtures/journey-project-fixture.mjs'

test('finished journey images decode with the same bundled exporter', (t) => {
  const projectsDir = makeTempDir('journey-export-fixture-')
  t.after(() => fs.rmSync(projectsDir, { recursive: true, force: true }))
  const seed = seedFinishedJourneyProject({ projectsDir })
  const { payload } = JSON.parse(fs.readFileSync(path.join(seed.projectRoot, '.nomi/project.json')))
  const nodes = payload.generationCanvas.nodes
  assert.equal(nodes.length, 6)
  assert.deepEqual(payload.timeline.tracks[0].clips.map((clip) => clip.url), nodes.map((node) => node.result.url))
  for (const node of nodes) {
    const relative = new URL(node.result.url).pathname.split('/').slice(2).join('/')
    execFileSync(ffmpeg.path, ['-v', 'error', '-i', path.join(seed.projectRoot, relative), '-frames:v', '1', '-f', 'null', '-'])
  }
})
