import { writeFileSync } from 'node:fs'
import { parentPort } from 'node:worker_threads'

parentPort.on('message', ({ target, content }) => {
  writeFileSync(target, content)
})
