import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 2026-09-17 走查 W-17 的回归：首次接入失败时说「原密钥和连接已保留」——用户没有原密钥。
// 这条断言的反面（把 previousKept 塞回 credential.invalid 里）会让第一条当场红。
describe('验证失败的那句话：保留子句只在真有原密钥时才说', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-cred-clause-'))
    process.env.NOMI_SETTINGS_DIR = root
    vi.resetModules()
  })
  afterEach(() => {
    delete process.env.NOMI_SETTINGS_DIR
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('两条描述里都不许再烤着保留子句', async () => {
    const { desktopT } = await import('../i18n')
    const kept = desktopT('credential.previousKept')
    expect(kept).toBeTruthy()
    for (const key of ['credential.invalid', 'credential.validationUnavailable'] as const) {
      expect(desktopT(key), key).not.toContain(kept)
    }
  })

  it('保留子句是独立的一条，两种语言都有', async () => {
    const { desktopT, setDesktopLocale } = await import('../i18n')
    setDesktopLocale('en')
    expect(desktopT('credential.previousKept')).toMatch(/previous key/i)
    setDesktopLocale('zh-CN')
    expect(desktopT('credential.previousKept')).toContain('原密钥')
  })
})
