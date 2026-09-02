// 钉死 CI 走查清单的准入门槛。
//
// 这份清单的价值全在「它说要跑的，CI 真的会跑，而且跑得出可信结果」。三种腐烂会让它变废纸：
//   ① 清单指向不存在的文件（走查被重命名/删除）→ 静默少跑一条，没人知道。
//   ② 有人把「需要真实 key / 会烧额度」的走查塞进来 → CI 上必红或必跳过，
//      长期红着的 CI 比不跑更糟：人会开始无视红灯，那才是真正不可逆的损失。
//   ③ 有人加了条目却不写理由 → 下一个人不知道它守的是什么不变量，出问题时不敢删也不敢改。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

import { ROSTER } from './ci-roster.mjs'

const uxDir = path.dirname(fileURLToPath(import.meta.url))
const read = (file) => fs.readFileSync(path.join(uxDir, file), 'utf8')

describe('CI 走查清单', () => {
  test('清单非空，且每条都指向真实存在的走查', () => {
    expect(ROSTER.length).toBeGreaterThan(0)
    const missing = ROSTER.filter((entry) => !fs.existsSync(path.join(uxDir, entry.file)))
    expect(missing.map((entry) => entry.file)).toEqual([])
  })

  test('每条都写清它守的是什么不变量（理由不能是占位）', () => {
    for (const entry of ROSTER) {
      expect(typeof entry.why, `${entry.file} 缺 why`).toBe('string')
      expect(entry.why.trim().length, `${entry.file} 的 why 太短，说不清守什么`).toBeGreaterThan(15)
    }
  })

  test('清单里没有依赖用户真实档案的走查（那不确定，CI 上必炸）', () => {
    const offenders = ROSTER.filter((entry) => {
      const source = read(entry.file)
      // 真实档案 = 这台机器上用户自己的 catalog：CI runner 上压根不存在，
      // 且它的 schema 版本还会随本地构建漂（2026-09-01 的只读假绿就是这么来的）。
      return /realCatalogPath|requireCatalog:\s*true/.test(source)
    })
    expect(offenders.map((entry) => entry.file)).toEqual([])
  })

  test('清单里没有会烧真实额度的走查（CI 不许花钱）', () => {
    const offenders = ROSTER.filter((entry) => {
      const source = read(entry.file)
      return /会花真实额度|真实额度|process\.env\.(APIMART|KIE|OPENAI|ANTHROPIC)_API_KEY/.test(source)
    })
    expect(offenders.map((entry) => entry.file)).toEqual([])
  })

  test('runner 与 CI workflow 确实挂上了这份清单（否则清单是废纸）', () => {
    const repoRoot = path.resolve(uxDir, '../..')
    const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-ci-walkthroughs.mjs'), 'utf8')
    expect(runner).toContain('ci-roster.mjs')

    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts['test:walkthroughs:ci']).toContain('run-ci-walkthroughs.mjs')

    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/quality-gate.yml'), 'utf8')
    expect(workflow).toContain('test:walkthroughs:ci')
  })
})
