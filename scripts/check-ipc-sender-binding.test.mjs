import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { makeTempDir } from './_test-temp.mjs'

const repoRoot = path.resolve(__dirname, '..')
const script = path.join(repoRoot, 'scripts', 'check-ipc-sender-binding.mjs')

/** 把门岗读的 electron/ 与基线复制到临时根；自测只改副本，绝不碰真仓库文件（推送前钩子会并发跑同一个门岗）。 */
function fixtureRoot() {
  const root = makeTempDir('nomi-ipc-binding-')
  fs.cpSync(path.join(repoRoot, 'electron'), path.join(root, 'electron'), { recursive: true })
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.copyFileSync(path.join(repoRoot, 'scripts', 'ipc-sender-binding-baseline.json'), path.join(root, 'scripts', 'ipc-sender-binding-baseline.json'))
  return root
}

describe('IPC sender scanner', () => {
  it('resolves its repository root on Windows', () => {
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' })
    expect(output).toMatch(/IPC sender binding/)
  })

  it('rejects a direct throwing guard inside ipcMain.on', () => {
    const root = fixtureRoot()
    const target = path.join(root, 'electron', 'main.ts')
    const original = fs.readFileSync(target, 'utf8')
    const safeCall = 'if (!assertTrustedFireAndForget(event, "nomi:app:reopen-library-window", assertTrustedSender)) return;'
    expect(original).toContain(safeCall)
    // 夹具未改动时必须是绿的，下面的红才证明是注入触发的。
    expect(execFileSync(process.execPath, [script, '--root', root], { encoding: 'utf8' })).toMatch(/IPC sender binding/)
    fs.writeFileSync(target, original.replace(safeCall, 'assertTrustedSender(event);'))
    expect(() => execFileSync(process.execPath, [script, '--root', root], { encoding: 'utf8', stdio: 'pipe' })).toThrow(/直接调用会抛异常/)
  })

  it('accepts a window registered through adoptMainWindow, and still rejects one with no registration', () => {
    const root = fixtureRoot()
    const target = path.join(root, 'electron', 'main.ts')
    const original = fs.readFileSync(target, 'utf8')
    // 夹具里 main.ts 经 adoptMainWindow 登记（不直接调 setMainWindow），必须是绿的。
    expect(original).toMatch(/\badoptMainWindow\s*\(/)
    expect(original).not.toMatch(/\b(?:registerAppWindow|setMainWindow)\s*\(/)
    expect(execFileSync(process.execPath, [script, '--root', root], { encoding: 'utf8' })).toMatch(/IPC sender binding/)
    // 反例：建了窗口、三种登记都没有 → 红。
    fs.writeFileSync(target, original.replace(/\badoptMainWindow\s*\(/g, 'noop('))
    expect(() => execFileSync(process.execPath, [script, '--root', root], { encoding: 'utf8', stdio: 'pipe' })).toThrow(/没登记信任角色/)
  })
})
