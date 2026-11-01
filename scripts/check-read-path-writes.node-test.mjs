import { makeTempDir } from './_test-temp.mjs'
// 「读路径不许可达写盘门」门岗的反例测试（R17：加规则必须先证明它会咬人）。
// 「项目在哪」收敛单（docs/plan/2026-10-29-project-location-owner.md）给它加了摘登记 / 写登记 / 读路径建目录这几扇门：
// 06-14 起 listProjects 凭「文件夹不在」摘登记，升级后整库项目没了，那时门岗只认三扇门，这条是绿的。
// 这里对一份夹具树跑同一个 CLI：把摘登记加回真实的 listProjects → 退出 1 并点名；不加 → 退出 0。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const gate = path.join(here, 'check-read-path-writes.mjs')

function fixtureTree(files, registered) {
  const root = makeTempDir('nomi-read-path-writes-')
  for (const [rel, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), source)
  }
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  const baseline = path.join(root, 'baseline.json')
  fs.writeFileSync(baseline, JSON.stringify({ registered }))
  return { root, baseline }
}

function runGate({ root, baseline }) {
  const result = spawnSync(process.execPath, [gate, `--root=${root}`, `--baseline=${baseline}`], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
}

const realRepository = fs.readFileSync(path.join(repoRoot, 'electron/projects/repository.ts'), 'utf8')
const LIST_PROJECTS_HEAD = /export async function listProjects\(\)[^{]*\{\n/
// 第一刀之后 listProjects 仍经启动对账写登记（第二刀挪走），真实基线里登记着这一对；夹具里只放这一对。
const LIST_PROJECTS_BIND = {
  site: 'electron/projects/repository.ts::listProjects',
  door: 'bindWorkspaceLocations',
  why: '启动对账登记新出现的项目文件夹（夹具照抄真实基线）',
}

test('真实的 listProjects：只有登记过的那一对，门岗通过', () => {
  assert.match(realRepository, LIST_PROJECTS_HEAD, '找不到 listProjects 的函数头——夹具要跟着改')
  const result = runGate(fixtureTree({ 'electron/projects/repository.ts': realRepository }, [LIST_PROJECTS_BIND]))
  assert.equal(result.status, 0, result.output)
})

test('把摘登记加回 listProjects：退出 1，点名这个函数和 removeWorkspaceReference（登记过别的门也挡不住）', () => {
  const mutated = realRepository.replace(LIST_PROJECTS_HEAD, (head) => `${head}  removeWorkspaceReference(getWorkspaceRepositoryDeps().settingsRoot, "x");\n`)
  assert.notEqual(mutated, realRepository)
  const result = runGate(fixtureTree({ 'electron/projects/repository.ts': mutated }, [LIST_PROJECTS_BIND]))
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /electron\/projects\/repository\.ts::listProjects: .*removeWorkspaceReference/)
})

for (const [label, fn] of [
  ['设置「检查目录」', 'checkProjectLocation'],
  ['设置「打开位置」', 'revealProjectLocation'],
  ['按 id 找项目目录', 'resolveProjectDirById'],
  ['「项目在哪」的读函数', 'locateWorkspaceProject'],
]) {
  test(`读路径建目录：${label}（${fn}）里 ensureDir → 退出 1`, () => {
    const source = `export function ${fn}(root: string) {\n  ensureDir(root);\n  return root;\n}\n`
    const result = runGate(fixtureTree({ 'electron/settings/location.ts': source }, []))
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, new RegExp(`${fn}: .*ensureDir`))
  })
}

test('同样的建目录放在用户显式动作里（pick / create）→ 通过', () => {
  const source = 'export function pickProjectLocation(root: string) {\n  ensureDir(root);\n}\nexport function createDefaultProject(root: string) {\n  ensureDir(root);\n}\n'
  const result = runGate(fixtureTree({ 'electron/settings/location.ts': source }, []))
  assert.equal(result.status, 0, result.output)
})

test('登记没写理由 → 退出 1；登记的那一对已经不可达 → 退出 1（棘轮只减不增）', () => {
  const noWhy = runGate(fixtureTree({ 'electron/projects/repository.ts': realRepository }, [{ ...LIST_PROJECTS_BIND, why: '' }]))
  assert.equal(noWhy.status, 1, noWhy.output)
  assert.match(noWhy.output, /why/)
  const stale = runGate(fixtureTree({ 'electron/projects/repository.ts': realRepository }, [
    LIST_PROJECTS_BIND,
    { site: 'electron/projects/repository.ts::listProjects', door: 'removeWorkspaceReference', why: '早已收敛掉的一对，留着就该红' },
  ]))
  assert.equal(stale.status, 1, stale.output)
  assert.match(stale.output, /登记在案但已经不可达/)
})
