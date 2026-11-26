import { parentPort } from 'node:worker_threads'
import { writeUiIpcFile } from '../uiIpcFile.mjs'

parentPort.on('message', ({ target, content }) => {
  writeUiIpcFile(target, content)
})
