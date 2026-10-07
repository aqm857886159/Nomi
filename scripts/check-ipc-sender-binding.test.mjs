import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

describe('IPC sender scanner', () => {
  it('resolves its repository root on Windows', () => {
    const script = path.join(process.cwd(), 'scripts', 'check-ipc-sender-binding.mjs')
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' })
    expect(output).toMatch(/IPC sender binding/)
  })

  it('rejects a direct throwing guard inside ipcMain.on', () => {
    const script = path.join(process.cwd(), 'scripts', 'check-ipc-sender-binding.mjs')
    const target = path.join(process.cwd(), 'electron', 'main.ts')
    const original = fs.readFileSync(target, 'utf8')
    const safeCall = 'if (!assertTrustedFireAndForget(event, "nomi:app:reopen-library-window", assertTrustedSender)) return;'
    expect(original).toContain(safeCall)
    try {
      fs.writeFileSync(target, original.replace(safeCall, 'assertTrustedSender(event);'))
      expect(() => execFileSync(process.execPath, [script], { encoding: 'utf8', stdio: 'pipe' })).toThrow(/直接调用会抛异常/)
    } finally {
      fs.writeFileSync(target, original)
    }
  })
})
