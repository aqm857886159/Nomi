// R-B7 `renderer-no-reach-local-cjs` 的反例单测：在一棵临时的小仓库上跑同一条 dependency-cruiser 规则（规则本身从
// .dependency-cruiser.mjs 读，不抄第二份）。渲染层隔几层走到仓库里的 CJS 都必须报；主进程自己用、渲染层只碰共享
// 转换模块都不报。规则的来由见 .dependency-cruiser.mjs 的 R-B7 注释。
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cruise } from 'dependency-cruiser'
import ruleConfig from '../.dependency-cruiser.mjs'
import { cleanupTestTemp, makeTempDir } from './_test-temp.mjs'

const RULE = ruleConfig.forbidden.find((rule) => rule.name === 'renderer-no-reach-local-cjs')
const VALIDATOR = 'electron/capabilityCore/validator.generated.cjs'

const write = (root, file, body) => {
  const full = path.join(root, file)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
}
const importing = (spec) => `import imported from '${spec}'\nexport const marker = imported\n`

let root
beforeAll(() => {
  root = makeTempDir('nomi-renderer-cjs-boundary-')
  write(root, VALIDATOR, 'module.exports = () => true\n')
  write(root, 'electron/capabilityCore/standardCheck.ts', importing('./validator.generated.cjs'))
  write(root, 'electron/shared/leakyShared.ts', importing('../capabilityCore/standardCheck'))
  write(root, 'electron/shared/conversion.ts', 'export default 1\n')
})
afterAll(() => cleanupTestTemp(root))

async function reachedFrom(from, body) {
  write(root, from, body)
  const result = await cruise([from], {
    baseDir: root,
    validate: true,
    ruleSet: { forbidden: [RULE] },
    tsPreCompilationDeps: true,
    outputType: 'json',
  })
  fs.rmSync(path.join(root, from))
  const output = typeof result.output === 'string' ? JSON.parse(result.output) : result.output
  return output.summary.violations.map((violation) => `${violation.from} -> ${violation.to}`)
}

describe('R-B7：渲染层的依赖图里不许有仓库自己的 CJS 文件', () => {
  it('规则在 .dependency-cruiser.mjs 里、是 error、看整条传递路径', () => {
    expect(RULE).toBeDefined()
    expect(RULE.severity).toBe('error')
    expect(RULE.from.path).toBe('^src/')
    expect(RULE.to.reachable).toBe(true)
  })

  it.each([
    { from: 'src/direct.ts', spec: `../${VALIDATOR}`, why: '直接 import' },
    { from: 'src/deep/viaCheck.ts', spec: '../../electron/capabilityCore/standardCheck', why: '隔一层主进程实现' },
    { from: 'src/deep/viaShared.ts', spec: '../../electron/shared/leakyShared', why: '隔着 electron/shared/ 两层' },
  ])('$from（$why）→ 报', async ({ from, spec }) => {
    expect(await reachedFrom(from, importing(spec))).toEqual([`${from} -> ${VALIDATOR}`])
  })

  it.each([
    { from: 'src/clean.ts', spec: '../electron/shared/conversion', why: '共享转换模块里没有 CJS' },
    { from: 'electron/capabilityCore/mainUser.ts', spec: './standardCheck', why: '主进程自己用' },
  ])('$from（$why）→ 不报', async ({ from, spec }) => {
    expect(await reachedFrom(from, importing(spec))).toEqual([])
  })
})
