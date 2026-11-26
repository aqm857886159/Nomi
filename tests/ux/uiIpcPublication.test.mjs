import fs from 'node:fs'
import path from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'
import { expect, test } from 'vitest'
import { makeTempDir } from '../../scripts/_test-temp.mjs'

test('the first read sees the complete request or response for this round', async ({ signal }) => {
  const dir = makeTempDir('ui-ipc-publication-')
  const writer = new Worker(new URL('./fixtures/uiIpcWriter.mjs', import.meta.url))
  const payload = 'x'.repeat(256 * 1024)
  const rounds = 2048
  const failures = { 'req.json': 0, 'res.json': 0 }
  let sampleFailure
  let writerError
  writer.on('error', error => { writerError = error })
  try {
    for (let sequence = 0; sequence < rounds; sequence++) {
      const request = sequence % 2 === 0
      const name = request ? 'req.json' : 'res.json'
      const target = path.join(dir, name)
      const message = request ? { sequence, action: 'fill', val: payload } : { sequence, value: payload }
      const content = JSON.stringify(message)
      writer.postMessage({ target, content })
      while (!fs.existsSync(target)) {
        if (writerError) throw writerError
        await setImmediate(undefined, { signal })
      }
      const text = fs.readFileSync(target, 'utf8')
      try {
        expect(JSON.parse(text)).toEqual(message)
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        failures[name]++
        sampleFailure ??= `${name} round=${sequence} bytes=${text.length}/${content.length}: ${error.message}`
      }
      fs.unlinkSync(target)
    }
    console.log(`${rounds} first reads: req.json parse failures=${failures['req.json']}, res.json parse failures=${failures['res.json']}`)
    expect(failures['req.json'] + failures['res.json'], sampleFailure).toBe(0)
  } finally {
    await writer.terminate()
  }
}, 60_000)
