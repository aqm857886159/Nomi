#!/usr/bin/env node
/**
 * 生成物「可合并性」类级门岗。
 *
 * 治的是这一类：**把全局语料的聚合派生物 commit 进仓库，再用逐字节精确匹配把关。**
 * 2026-09-02 实测（docs/fixes/2026-09-02-unmergeable-generated-artifact.root-cause.json）：
 * 两个分支各加一篇方案文档、各自重生成 docs/DELIVERY-LEDGER.md，两边门岗都绿；合并后 main 红。
 *
 * 判据不是「合并会不会冲突」——冲突可以人工解对，不致命。
 * 判据是**可达性**：合并结果里有没有「A、B、base 谁都没写过」的那一行。
 * 人工解冲突只能在三方各自写过的行里取舍，变不出第四种内容。所以只要这种行存在，
 * 该产物就**在原理上无法靠解冲突得到正确结果**，必须重跑生成器——而 GitHub 的合并
 * 按钮永远不会重跑。账本正是如此：两边计数都从 30→31，git 无冲突地取 31，真值却是 32。
 *
 * 因此本测试对 COMMITTED_ARTIFACTS 里的**每一份**产物实测该不变量；
 * 谁将来往里加一份带计数/分桶的产物，这里立刻红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { COMMITTED_ARTIFACTS, LOCAL_ARTIFACTS } from './build-delivery-ledger.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLAN_ROOTS = ['docs/plan', 'docs/superpowers/plans']

const doc = (relativePath, title, status = '🚧') => ({ relativePath, status, title })

/**
 * 一次真实分叉：base 分出 A、B，两边各加一篇方案文档（两个方案根目录都加，
 * 这样不论产物只渲染哪个根，都能看到新增），合并后的真实语料是 union。
 */
function forkScenario() {
  const base = PLAN_ROOTS.flatMap((dir) => [
    doc(`${dir}/2026-08-01-alpha.md`, 'Alpha 方案'),
    doc(`${dir}/2026-08-02-beta.md`, 'Beta 方案'),
  ])
  const onlyA = PLAN_ROOTS.map((dir) => doc(`${dir}/2026-09-02-from-branch-a.md`, '分支 A 的方案'))
  const onlyB = PLAN_ROOTS.map((dir) => doc(`${dir}/2026-09-02-from-branch-b.md`, '分支 B 的方案'))
  return {
    base,
    a: [...base, ...onlyA],
    b: [...base, ...onlyB],
    union: [...base, ...onlyA, ...onlyB],
  }
}

/** 合并结果里「三方谁都没写过」的行——非空 = 人工解冲突解不出正确结果。 */
function unreachableLines(renderer, scenario) {
  const written = new Set(
    [scenario.base, scenario.a, scenario.b].flatMap((documents) => renderer(documents).split('\n')),
  )
  return renderer(scenario.union)
    .split('\n')
    .filter((line) => line.trim() !== '' && !written.has(line))
}

const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()

test('committed 产物必须可合并：合并结果的每一行，三方之中都有人写过', () => {
  assert.ok(COMMITTED_ARTIFACTS.length > 0, 'committed 产物清单不应为空')
  const scenario = forkScenario()
  for (const artifact of COMMITTED_ARTIFACTS) {
    const unreachable = unreachableLines(artifact.renderer, scenario)
    assert.deepEqual(
      unreachable,
      [],
      `${artifact.label} 含全局聚合量：合并后会出现下面这些「谁都没写过」的行，`
        + `人工解冲突产生不了它们，服务端 merge 也不会重跑生成器 → main 必红。`
        + `\n把这些聚合量从产物里去掉，或把该产物移出 COMMITTED_ARTIFACTS（改成本地视图）：`
        + `\n  ${unreachable.join('\n  ')}`,
    )
  }
})

// 阳性对照：证明上面那条断言真的有分辨力。账本 renderer 含聚合量，必须被抓出来；
// 抓不出来 = 门岗失效（会静静地放行下一份不可合并的产物），比漏检更危险。
test('阳性对照：账本 renderer 含聚合量，必须被判为不可合并', () => {
  const ledger = LOCAL_ARTIFACTS.find((artifact) => artifact.label.endsWith('DELIVERY-LEDGER.md'))
  assert.ok(ledger, '账本应登记在 LOCAL_ARTIFACTS 里')
  const unreachable = unreachableLines(ledger.renderer, forkScenario())
  assert.ok(
    unreachable.length > 0,
    '账本含「现役欠账（N）」等聚合量，本该被判为不可合并——判不出来说明本测试已失去分辨力',
  )
  assert.ok(
    unreachable.some((line) => /现役欠账（\d+）/.test(line)),
    `聚合量应当出现在不可达行里，实际抓到：\n  ${unreachable.join('\n  ')}`,
  )
})

test('committed 产物进 git；local 产物被 gitignore 挡在 git 之外', () => {
  for (const artifact of COMMITTED_ARTIFACTS) {
    assert.notEqual(git('ls-files', '-z', '--', artifact.label), '', `${artifact.label} 应当被 git 跟踪`)
  }
  for (const artifact of LOCAL_ARTIFACTS) {
    assert.equal(
      git('ls-files', '-z', '--', artifact.label),
      '',
      `${artifact.label} 是本地视图，不该进 git——它一旦被 commit，合并潮期 main 会反复变红`,
    )
    assert.notEqual(
      git('check-ignore', '--', artifact.label),
      '',
      `${artifact.label} 必须写进 .gitignore，否则下次 git add -A 又会把它带进去`,
    )
  }
})
