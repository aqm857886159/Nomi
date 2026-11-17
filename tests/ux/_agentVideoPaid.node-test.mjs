import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { probeLandedMedia } from './_agentVideoPaid.mjs'

test('landed video and audio use the bundled probe without a system installation', async (t) => {
  const root = makeTempDir('landed-media-probe-')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=1', '-t', '1', '-pix_fmt', 'yuv420p', path.join(root, 'video.mp4')])
  execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', path.join(root, 'audio.wav')])
  const previousPath = process.env.PATH
  const previousProbe = process.env.NOMI_FFPROBE_PATH
  process.env.PATH = ''
  delete process.env.NOMI_FFPROBE_PATH
  try {
    for (const [file, kind] of [['video.mp4', 'video'], ['audio.wav', 'audio']]) {
      const media = await probeLandedMedia(root, 'project-a', `nomi-local://asset/project-a/${file}`)
      assert.equal(media.probe.kind, kind)
      assert.ok(media.bytes > 0)
      assert.ok(media.probe.durationSeconds > 0)
    }
    await assert.rejects(probeLandedMedia(root, 'project-b', 'nomi-local://asset/project-a/video.mp4'), /属于别的项目/)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousProbe === undefined) delete process.env.NOMI_FFPROBE_PATH
    else process.env.NOMI_FFPROBE_PATH = previousProbe
  }
})
