import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

describe('IPC sender scanner', () => {
  it('resolves its repository root on Windows', () => {
    const script = path.join(process.cwd(), 'scripts', 'check-ipc-sender-binding.mjs')
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' })
    expect(output).toMatch(/IPC sender binding/)
  })
})
