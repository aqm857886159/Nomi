import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function check(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-file-sizes-'))
  temporaryRoots.push(root)
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.copyFileSync(path.join(repoRoot, 'scripts/check-file-sizes.mjs'), path.join(root, 'scripts/check-file-sizes.mjs'))
  // 门岗从 scripts/lib/gitPaths.mjs 取受跟踪文件列表（`-z`，见 2026-09-07 的 quotePath 修复），
  // fixture 必须把它一起带上——否则跑出来的是 ERR_MODULE_NOT_FOUND，而断言只看 stderr 里有没有
  // 那一行，红得像「门岗没抓到超长文件」，其实门岗根本没启动。
  fs.mkdirSync(path.join(root, 'scripts/lib'), { recursive: true })
  fs.copyFileSync(path.join(repoRoot, 'scripts/lib/gitPaths.mjs'), path.join(root, 'scripts/lib/gitPaths.mjs'))
  execFileSync('git', ['init', '--quiet', root])
  for (const [relative, lines] of Object.entries(files)) {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '// fixture\n'.repeat(lines))
    execFileSync('git', ['add', '--', relative], { cwd: root })
  }
  return spawnSync(process.execPath, [path.join(root, 'scripts/check-file-sizes.mjs')], { cwd: root, encoding: 'utf8' })
}

describe('native TypeScript file-size gate', () => {
  test.each(['mts', 'cts'])('rejects a new 801-line .%s production module', (extension) => {
    const file = `electron/harness/runtime/pi/oversized.${extension}`
    const result = check({ [file]: 801 })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`${file}: 801`)
  })

  test('keeps 800-line native sources and declaration/test exclusions within the same bound', () => {
    const result = check({
      'electron/harness/runtime/pi/session.mts': 800,
      'electron/harness/runtime/pi/host.cts': 800,
      'electron/harness/runtime/pi/session.test.mts': 801,
      'electron/harness/runtime/pi/host.test.cts': 801,
      'electron/harness/runtime/pi/session.d.mts': 801,
      'electron/harness/runtime/pi/host.d.cts': 801,
    })
    expect(result.status, result.stderr).toBe(0)
  })
})
