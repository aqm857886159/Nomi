// R-B7 `src-no-import-devlab` 的反例单测：在一棵临时的小仓库上跑同一条 dependency-cruiser 规则（规则从
// .dependency-cruiser.mjs 读，不抄第二份）。产品代码一 import 设计实验室就必须报——最要紧的一条是编辑器宿主
// 引实验室那个「写死一份值的 owner」（引进来就又是一个拿着旧副本的编辑器）；实验室自己、组件测试引它都不报。
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cruise } from 'dependency-cruiser'
import ruleConfig from '../.dependency-cruiser.mjs'
import { cleanupTestTemp, makeTempDir } from './_test-temp.mjs'

const RULE = ruleConfig.forbidden.find((rule) => rule.name === 'src-no-import-devlab')
const FIXED_OWNER = 'src/devlab/designLab/fixedEditorOwner.ts'

const write = (root, file, body) => {
  const full = path.join(root, file)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, `${body}\nexport const marker = 1\n`)
}
const importOf = (from, to) => {
  const spec = path.posix.relative(path.posix.dirname(from), to).replace(/\.tsx?$/, '')
  return `import { marker as imported } from '${spec.startsWith('.') ? spec : `./${spec}`}'\nvoid imported`
}

let root
beforeAll(() => {
  root = makeTempDir('nomi-devlab-boundary-')
  write(root, FIXED_OWNER, '')
})
afterAll(() => cleanupTestTemp(root))

async function violationsFor(from, to) {
  write(root, from, importOf(from, to))
  const result = await cruise([from], { baseDir: root, validate: true, ruleSet: { forbidden: [RULE] }, tsPreCompilationDeps: true, outputType: 'json' })
  fs.rmSync(path.join(root, from))
  const output = typeof result.output === 'string' ? JSON.parse(result.output) : result.output
  return output.summary.violations.map((violation) => `${violation.from} -> ${violation.to}`)
}

describe('R-B7：产品代码不许引设计实验室', () => {
  it('规则在 .dependency-cruiser.mjs 里、是 error', () => {
    expect(RULE).toBeDefined()
    expect(RULE.severity).toBe('error')
  })

  it.each([
    'src/workbench/assets/FakePromptHost.tsx',
    'src/workbench/creation/FakeDocHost.tsx',
    'src/App.tsx',
  ])('%s import 实验室的固定 owner → 报', async (from) => {
    expect(await violationsFor(from, FIXED_OWNER)).toEqual([`${from} -> ${FIXED_OWNER}`])
  })

  it.each([
    { from: 'src/devlab/designLab/storyboard/FakeLabKit.tsx', why: '实验室自己取景' },
    { from: 'src/workbench/ai/v4/fakeComposer.test.ts', why: '组件测试' },
  ])('$from（$why）→ 不报', async ({ from }) => {
    expect(await violationsFor(from, FIXED_OWNER)).toEqual([])
  })
})
