import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { gateEntryFiles, PRE_PUSH_GATES, SCAN_TESTS } from './pre-push-contracts.mjs'
import { walkSites } from './lib/scanGuardDetect.mjs'
import { trackedFiles } from './lib/gitPaths.mjs'
import { makeTempDir } from './_test-temp.mjs'

/** 已存在、尚未迁移的推送前脚本扫描路径；只减不增，迁走时同提交删除。 */
export const REPO_SCAN_BASELINE = Object.freeze([
  'scripts/check-asset-evidence.mjs',
  'scripts/check-batch-machines.mjs',
  'scripts/check-board-parity.mjs',
  'scripts/check-capability-lifecycle.mjs',
  'scripts/check-control-contract.mjs',
  'scripts/check-canvas-edge-writers.mjs',
  'scripts/check-canvas-gesture-determinism.mjs',
  'scripts/check-dangling-tailwind.mjs',
  'scripts/check-design-lab.mjs',
  'scripts/check-error-surface.mjs',
  'scripts/check-framework-boundary.mjs',
  'scripts/check-full-walk-catalog.mjs',
  'scripts/check-git-path-quoting.mjs',
  'scripts/check-heavy-path.mjs',
  'scripts/check-icon-semantics.mjs',
  'scripts/check-ipc-sender-binding.mjs',
  'scripts/check-media-import-owner.mjs',
  'scripts/check-mjs-parse.mjs',
  'scripts/check-mockup-contracts.mjs',
  'scripts/check-no-default-overwrite.mjs',
  'scripts/check-outbound-policy.mjs',
  'scripts/check-platform-archetypes.mjs',
  'scripts/check-read-path-writes.mjs',
  'scripts/check-run-task-grant.mjs',
  'scripts/check-script-network-retry.mjs',
  'scripts/check-skill-ipc-coverage.mjs',
  'scripts/check-store-lifetime.mjs',
  'scripts/check-storyboard-owner.mjs',
  'scripts/check-supply-chain-pins.mjs',
  'scripts/check-walkthroughs.mjs',
  'scripts/check-workflow-protected-writes.mjs',
  'scripts/check-workflow-script-refs.mjs',
])

/** 从门表的 argv / package.json 命令推导推送前实际执行的脚本，不写死扫描器清单。 */
export function prePushScriptFiles() {
  const names = [...PRE_PUSH_GATES.map(({ name }) => name), ...SCAN_TESTS.map(({ name }) => name)]
  return [...new Set(names.flatMap((name) => gateEntryFiles(name)))]
    .filter((file) => file.startsWith('scripts/') && !/(?:\.test\.|node-test)/.test(file))
    .sort()
}

export function repositoryWalkFiles(files, readSource = (file) => fs.readFileSync(file, 'utf8')) {
  return files.filter((file) => walkSites(file, readSource(file)).some((site) => site.kind === 'readdirSync' && site.anchored))
}

export function baselineProblems({ files, baseline = REPO_SCAN_BASELINE, readSource }) {
  const actual = new Set(repositoryWalkFiles(files, readSource))
  const expected = new Set(baseline)
  return [
    ...[...actual].filter((file) => !expected.has(file)).map((file) => `${file}：新增 readdirSync 仓库递归遍历，请改用 trackedFiles()`),
    ...[...expected].filter((file) => !actual.has(file)).map((file) => `${file}：冻结基线仍列此路径，但文件已迁走；同提交删除基线项`),
  ]
}

test('推送前扫描脚本从门表推导，现有 readdirSync 路径与冻结基线一致', () => {
  assert.deepEqual(baselineProblems({ files: prePushScriptFiles() }), [])
})

test('反例：不在基线里的推送前检查写回 readdirSync 时点名文件', () => {
  const target = prePushScriptFiles().find((file) => !REPO_SCAN_BASELINE.includes(file))
  assert.ok(target, '门表应至少有一个已迁移脚本用于反例')
  const problems = baselineProblems({ files: [target], readSource: () => 'fs.readdirSync(repoRoot, { recursive: true })' })
  assert.ok(problems.some((problem) => problem.startsWith(`${target}：`)), problems.join('\n'))
})

test('反例：基线删掉仍在遍历的路径时点名文件', () => {
  const target = REPO_SCAN_BASELINE[0]
  const problems = baselineProblems({
    files: prePushScriptFiles(),
    baseline: REPO_SCAN_BASELINE.filter((file) => file !== target),
  })
  assert.ok(problems.some((problem) => problem.startsWith(`${target}：新增`)), problems.join('\n'))
})

test('反例：文件已迁走但冻结基线未删时点名文件', () => {
  const target = REPO_SCAN_BASELINE[0]
  const problems = baselineProblems({
    files: prePushScriptFiles(),
    readSource: (file) => file === target ? '' : fs.readFileSync(file, 'utf8'),
  })
  assert.ok(problems.some((problem) => problem.startsWith(`${target}：冻结`)), problems.join('\n'))
})

test('trackedFiles 过滤索引仍跟踪但磁盘已删除的文件', () => {
  const root = makeTempDir('nomi-tracked-deleted-')
  try {
    execFileSync('git', ['init', '-q'], { cwd: root })
    fs.writeFileSync(path.join(root, 'deleted.json'), 'deleted\n')
    execFileSync('git', ['add', 'deleted.json'], { cwd: root })
    fs.rmSync(path.join(root, 'deleted.json'))
    assert.deepEqual(trackedFiles({ cwd: root }), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('trackedFiles 只返回会进提交的文件，gitignore 产物不算', () => {
  const root = makeTempDir('nomi-tracked-scan-')
  try {
    execFileSync('git', ['init', '-q'], { cwd: root })
    fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.json\n')
    fs.writeFileSync(path.join(root, 'ignored.json'), 'ignored\n')
    fs.writeFileSync(path.join(root, 'tracked.json'), 'tracked\n')
    execFileSync('git', ['add', '.gitignore', 'tracked.json'], { cwd: root })
    assert.deepEqual(trackedFiles({ cwd: root }), ['.gitignore', 'tracked.json'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
