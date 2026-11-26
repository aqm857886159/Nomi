import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

// Readers treat the final name as the signal that the whole message is ready.
export function writeUiIpcFile(target, content) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, content)
    fs.renameSync(temporary, target)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}
