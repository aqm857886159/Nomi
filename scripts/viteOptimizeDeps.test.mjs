import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Vite dependency pre-bundling', () => {
  it('keeps i18n dependencies explicit when automatic discovery is disabled', () => {
    const root = process.cwd()
    const config = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8')
    const entry = fs.readFileSync(path.join(root, 'src/dev/optimizeDepsEntry.ts'), 'utf8')

    expect(config).toContain('noDiscovery: true')
    expect(config).toMatch(/include:\s*\[[\s\S]*['"]i18next['"]/)
    expect(config).toMatch(/include:\s*\[[\s\S]*['"]react-i18next['"]/)
    expect(entry).toContain("import 'i18next';")
    expect(entry).toContain("import 'react-i18next';")
  })

  // 2026-10-09（#1136 外壳重设计）：新依赖 react-rnd 的 ESM 入口再 import 纯 CJS 的 react-draggable，
  // noDiscovery 下没进 optimizeDeps.include → dev 服务器里工作台卡在加载标起不来，CI 的 Canvas Acceptance 整片红
  // （生产构建走 Rollup 不受影响，所以本地 build 绿、各门岗绿都没看见）。
  // 「一个包 dev 下能不能直接用」没法从 package.json 静态判准（react-rnd 自己有 module 字段，坏在它依赖的 react-draggable 上），
  // 所以不猜，改成棘轮：渲染进程每个直接依赖，要么在 include 里，要么在下面这份冻结的「已知 dev 下直接可用」清单里。
  // 新加一个渲染依赖 = 这条红，逼你当场决定；默认答案是加进 include（总是安全）。清单只许减不许增。
  it('渲染进程的每个直接依赖：要么预打包进 optimizeDeps.include，要么在冻结的「dev 下直接可用」清单里（新依赖不许悄悄漏掉）', () => {
    const root = process.cwd()
    const config = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8')
    const included = new Set([...config.matchAll(/^\s*'([^']+)',?\s*$/gm)].map((match) => match[1]))
    const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\b)[^'"\n]*?from\s*['"]([^'"./][^'"]*)['"]|^\s*import\s*['"]([^'"./][^'"]*)['"]/gm
    const specs = new Set()
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec|bench)\.|\.d\.ts$/.test(entry.name)) continue
        for (const match of fs.readFileSync(full, 'utf8').matchAll(IMPORT_RE)) specs.add(match[1] ?? match[2])
      }
    }
    walk(path.join(root, 'src'))
    const pkgOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
    const KNOWN_OK_RAW_IN_DEV = new Set([
      '@fontsource-variable/fraunces', '@fontsource-variable/inter', '@imgly/background-removal', '@mantine/hooks',
      '@radix-ui/react-dropdown-menu', '@radix-ui/react-focus-scope', '@radix-ui/react-tooltip', '@sparkjsdev/spark',
      '@streamdown/cjk', '@streamdown/code', '@tabler/icons-react', '@tiptap/pm', '@xyflow/react', 'fflate', 'img-fx',
      'immer', 'js-yaml', 'marked', 'onnxruntime-web', 'perfect-freehand', 'react-resizable-panels',
    ])
    const leaked = [...new Set([...specs].filter((spec) => !spec.startsWith('node:')).map(pkgOf))]
      .filter((name) => fs.existsSync(path.join(root, 'node_modules', name)) && !included.has(name) && !KNOWN_OK_RAW_IN_DEV.has(name))
      .sort()
    expect(
      leaked,
      `这些渲染依赖没进 vite.config.ts 的 optimizeDeps.include（也没在已知清单里）：\n${leaked.join('\n')}\n`
        + '默认做法：同时加进 vite.config.ts 的 include 与 src/dev/optimizeDepsEntry.ts。dev 服务器 noDiscovery，漏掉带 CJS 依赖的包会让工作台起不来。',
    ).toEqual([])
  })
})
