// archetype-autosync 工作流的形状测试：原 check:archetype-defaults 改成自动重新生成后，这条流水线是唯一的补齐主体。
// 钉的是它的写入面和发布方式（和 docs/fixes/docs-autosync.node-test.mjs 同一套纪律：固定分支、默认 token、不递归、不跳 CI），
// 以及它真的会先重新生成再发布、写入范围只有生成文件。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const raw = fs.readFileSync(path.join(repoRoot, '.github/workflows/archetype-autosync.yml'), 'utf8')
const workflow = yaml.load(raw)
const steps = workflow.jobs.autosync.steps
const publish = steps.find((step) => step.id === 'publish')

test('只在 main 前进和手动触发，固定分支只有一个写者', () => {
  assert.deepEqual(workflow.on.push.branches, ['main'])
  assert.deepEqual(workflow.on.workflow_dispatch, {})
  assert.equal(workflow.concurrency.group, 'archetype-autosync')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.equal(publish.uses, 'peter-evans/create-pull-request@v7')
  assert.equal(publish.with.branch, 'chore/archetype-autosync')
  assert.equal(publish.with['branch-suffix'], undefined)
  assert.deepEqual(workflow.permissions, { contents: 'write', 'pull-requests': 'write' })
  assert.equal(publish.with.token, '${{ secrets.GITHUB_TOKEN }}')
})

test('先装依赖、再重新生成，最后才发布；不递归、不跳 CI、不手写 push', () => {
  const install = steps.findIndex((step) => /pnpm install --frozen-lockfile/.test(step.run ?? ''))
  const regenerate = steps.findIndex((step) => step.run === 'pnpm run gen:archetype-defaults')
  assert.ok(install >= 0 && regenerate > install && steps.indexOf(publish) > regenerate)
  assert.doesNotMatch(raw.replace(/#[^\n]*/g, ''), /gh pr create|git push|\[(?:skip ci|ci skip|no ci)\]|skip-checks|--force|--no-verify/i)
})

test('写入范围只有生成文件：不含 docs，也不含手写源码', () => {
  const paths = publish.with['add-paths'].trim().split('\n').map((line) => line.trim())
  assert.ok(paths.length >= 3)
  for (const entry of paths) assert.match(entry, /^electron\/catalog\/archetype[A-Za-z.*]*\.generated\.ts$/, entry)
  assert.ok(!paths.some((entry) => entry.startsWith('docs')))
})

test('生成器真的写这几个文件（add-paths 与生成器输出不能漂）', () => {
  const generator = fs.readFileSync(path.join(repoRoot, 'scripts/gen-archetype-wire-defaults.ts'), 'utf8')
  for (const name of ['archetypeIdentifiers.generated.ts', 'archetypeModes.generated.ts']) {
    assert.ok(generator.includes(name), `${name} 不在生成器输出里`)
  }
  assert.ok(generator.includes('archetypeModes.${slug}.generated.ts'), '分片文件名漂了')
})
