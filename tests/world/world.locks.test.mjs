import { makeTempDir } from '../../scripts/_test-temp.mjs'
/* global process */
// 测试世界两把锁 + 冻结命名空间的元测试（D-test-world-owner-only 批 1）。
// 做法：起一个子 vitest（tests/world/fixtures/vitest.meta.config.ts：同一套插件和 setup），跑固定夹具，
// 期望「坏写法」夹具一份份红且报错码对、「好写法」夹具一份份绿。锁失效、或升 vitest 后门换了，这里就红。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { judgeWrite, parseStack } from './fsJudge'
import { OWNER_MODULES, REPO_ROOT, isTestSideFile } from './ownerModules'
import { OWNER_FILE_NAMES } from './ownerFiles'
import { listOldUserData } from './oldUserData.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

describe('夹具：坏写法红、好写法绿', () => {
  /** @type {Map<string, { status: string, message: string }>} */
  const results = new Map()

  beforeAll(() => {
    const out = path.join(makeTempDir('nomi-world-meta-'), 'result.json')
    const env = { ...process.env, NO_COLOR: '1' }
    delete env.NOMI_WORLD_LOCK_RECORD
    const run = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'tests/world/fixtures/vitest.meta.config.ts', '--reporter=json', `--outputFile=${out}`],
      { cwd: REPO_ROOT, env, encoding: 'utf8', timeout: 150_000 },
    )
    if (!fs.existsSync(out)) throw new Error(`子 vitest 没产出结果：${run.stderr || run.stdout}`)
    const report = JSON.parse(fs.readFileSync(out, 'utf8'))
    for (const file of report.testResults) {
      const name = path.basename(file.name)
      const failed = file.assertionResults.find((a) => a.status !== 'passed')
      results.set(name, {
        status: file.status === 'passed' && !failed ? 'passed' : 'failed',
        message: [file.message, ...file.assertionResults.flatMap((a) => a.failureMessages ?? [])].filter(Boolean).join('\n'),
      })
    }
  }, 180_000)

  const expectRed = (file, pattern) => {
    const hit = results.get(file)
    expect(hit, `${file} 没有结果`).toBeTruthy()
    expect(hit.status, `${file} 应该红，却绿了：锁没拦住`).toBe('failed')
    expect(hit.message).toMatch(pattern)
  }

  it('手写 model-catalog.json：写的那一刻红，报错点名三扇门', () => {
    expectRed('hand-write-catalog.bad.node-test.ts', /world_file_hand_written: .*model-catalog\.json/s)
    expectRed('hand-write-catalog.bad.node-test.ts', /buildWorld.*seedOldUserData.*damageWorldFile/s)
  })
  it('cpSync 拷一整个含主人文件的目录：红', () => expectRed('hand-write-catalog-copy.bad.node-test.ts', /world_file_hand_written/))
  it('拿存盘原语 writeJsonFileAtomic 写手写内容：红', () => expectRed('hand-write-via-primitive.bad.node-test.ts', /world_file_hand_written/))
  it('测试直接调主人的写口（mutateCatalog）：红', () => expectRed('owner-write-path.bad.node-test.ts', /world_file_hand_written/))
  it('vi.mock 主人模块：登记那一刻红', () => expectRed('mock-owner.bad.node-test.ts', /owner_module_mock_refused: electron\/catalog\/catalogStore\.ts/))
  it('vi.doMock 主人模块：登记那一刻红', () => expectRed('domock-owner.bad.node-test.ts', /owner_module_mock_refused: electron\/projects\/repository\.ts/))
  it('vi.spyOn 主人命名空间：做不出来', () => expectRed('spyon-owner.bad.node-test.ts', /Cannot (spy on export|redefine property)/))
  it('Object.defineProperty 改主人命名空间：做不出来', () => expectRed('define-property-owner.bad.node-test.ts', /Cannot redefine property/))

  it('buildWorld / damageWorldFile / worldRows / seedOldUserData：放行', () => {
    expect(results.get('build-world.ok.node-test.ts')?.message ?? '').toBe('')
    expect(results.get('build-world.ok.node-test.ts')?.status).toBe('passed')
  })
  it('不误伤：写非主人文件、mock electron、测试调非主人产品函数：放行', () => {
    expect(results.get('not-owner.ok.node-test.ts')?.message ?? '').toBe('')
    expect(results.get('not-owner.ok.node-test.ts')?.status).toBe('passed')
  })

  it('夹具目录里每份 .bad / .ok 都有结果（防夹具被改名后静默不跑）', () => {
    const names = fs.readdirSync(path.join(here, 'fixtures')).filter((n) => /\.(bad|ok)\.node-test\.ts$/.test(n))
    expect(names.length).toBeGreaterThanOrEqual(10)
    for (const name of names) expect(results.has(name), `${name} 子 vitest 没跑它`).toBe(true)
  })
})

describe('写盘判决（纯函数）', () => {
  const frame = (file, fn = '') => ({ file: path.join(REPO_ROOT, file), fn })
  it('第一帧是测试 → 拦', () => {
    expect(judgeWrite([frame('electron/foo.test.ts')])).toEqual({ block: true, reason: 'first-frame-test' })
  })
  it('经 tests/world 的帧 → 放行', () => {
    expect(judgeWrite([frame('tests/world/index.ts'), frame('electron/foo.test.ts')])).toEqual({ block: false })
  })
  it('测试 → 存盘原语 → 拦；测试 → 非主人产品函数 → 放行', () => {
    expect(judgeWrite([frame('electron/jsonFile.ts'), frame('electron/foo.test.ts')])).toMatchObject({ block: true, reason: 'raw-primitive' })
    expect(judgeWrite([frame('electron/jsonFile.ts'), frame('electron/catalog/catalogStore.ts'), frame('electron/catalog/customCallDraft.ts'), frame('electron/foo.test.ts')])).toEqual({ block: false })
  })
  it('测试在主人自己的目录里直调主人写口 → 放行；在别处 → 拦', () => {
    expect(judgeWrite([frame('electron/catalog/catalogStore.ts'), frame('electron/catalog/catalogStore.test.ts')])).toEqual({ block: false })
    expect(judgeWrite([frame('electron/catalog/catalogStore.ts'), frame('electron/foo/bar.test.ts')])).toMatchObject({ block: true, reason: 'owner-write-path' })
  })
  it('parseStack 取绝对路径帧', () => {
    const frames = parseStack(`Error\n    at f (${REPO_ROOT}/a.ts:1:2)\n    at ${REPO_ROOT}/b.ts:3:4\n    at node:internal/x:1:1`)
    expect(frames.map((f) => path.basename(f.file))).toEqual(['a.ts', 'b.ts'])
  })
})

describe('名单一致性', () => {
  it('主人模块名单：每条路径真存在；settings 目录里的写口都收进来', () => {
    for (const rel of OWNER_MODULES) expect(fs.existsSync(path.join(REPO_ROOT, rel)), rel).toBe(true)
    const settingsWriters = fs
      .readdirSync(path.join(REPO_ROOT, 'electron/settings'))
      .filter((n) => /(Settings|Preference|InstallSeed)\.ts$/.test(n))
    for (const name of settingsWriters) expect(OWNER_MODULES).toContain(`electron/settings/${name}`)
  })
  it('主人存盘文件名：取自产品里的两张表（26 个），不手抄', () => {
    expect(OWNER_FILE_NAMES.has('model-catalog.json')).toBe(true)
    expect(OWNER_FILE_NAMES.size).toBe(26)
  })
  it('冻结名单：文件都真存在、没重复、已排序', () => {
    for (const lock of ['fsLock', 'exportLock']) {
      const { files } = JSON.parse(fs.readFileSync(path.join(here, 'not-yet-migrated', `${lock}.json`), 'utf8'))
      expect(files, lock).toEqual([...new Set(files)].sort())
      for (const rel of files) expect(fs.existsSync(path.join(REPO_ROOT, rel)), `${lock}: ${rel}`).toBe(true)
    }
  })
  it('夹具文件算测试侧：.node-test.ts 在 tests/world 里也被认作测试', () => {
    expect(isTestSideFile('tests/world/fixtures/a.bad.node-test.ts')).toBe(true)
    expect(isTestSideFile('tests/world/index.ts')).toBe(false)
  })
  it('旧数据名册由 fixtures 目录派生，且能分出 settings / projects', () => {
    const roster = listOldUserData()
    expect(roster.length).toBeGreaterThan(0)
    expect(new Set(roster.map((r) => r.kind))).toEqual(new Set(['settings', 'projects']))
    for (const item of roster) expect(fs.existsSync(path.join(REPO_ROOT, 'tests/fixtures/old-user-data', item.id))).toBe(true)
  })
})
