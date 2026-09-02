import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// 类级回归测试：供应商展示名的翻译契约。
//
// 钉的是 2026-09-02 那个洞的**类**——不是「火山方舟译了没」，而是「一个内置供应商的展示名
// 没有英文说法时，门岗会不会拦」。门岗真正的对外契约就是「退出码 + 说明哪一条不合格」，
// 所以这里按黑盒跑真脚本：把脚本和词典各复制一份到临时目录、只改副本、看真脚本怎么判。
// 不改仓库里的真文件，也不需要把 600 行的门岗脚本改造成可 import（改造本身就有破坏风险）。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = path.join(repoRoot, 'scripts', 'check-i18n-visible-text.mjs')
const SEAM = path.join(repoRoot, 'src', 'i18n', 'locales', 'modelDisplayText.ts')
// 脚本一切路径都从 process.cwd() 算（ROOT = process.cwd()），所以副本本身放哪都行，
// 只要起子进程时 cwd=repoRoot。但 node 解析 `import ts from 'typescript'` 是按**文件所在位置**
// 往上找 node_modules 的，放 os.tmpdir() 会 ERR_MODULE_NOT_FOUND；放在 node_modules/.cache 下
// 既能解析到依赖，又不在任何门岗的扫描范围里（不会被 filesize/token/i18n 自己扫到）。
const SCRATCH_ROOT = path.join(repoRoot, 'node_modules', '.cache')
const SEAM_ANCHOR = `const MODEL_DISPLAY_TEXT_FILE = path.join(SRC_ROOT, 'i18n', 'locales', 'modelDisplayText.ts')`

let tempDir: string | null = null

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

type Mutations = { script?: (source: string) => string; seam?: (source: string) => string }

/** 跑一份（可选被改动的）门岗副本，返回退出码与合并输出。 */
function runGate({ script = (s) => s, seam = (s) => s }: Mutations = {}): { code: number; output: string } {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true })
  tempDir = fs.mkdtempSync(path.join(SCRATCH_ROOT, 'nomi-i18n-gate-'))
  const seamCopy = path.join(tempDir, 'seamCopy.ts')
  fs.writeFileSync(seamCopy, seam(fs.readFileSync(SEAM, 'utf8')))

  const mutated = script(fs.readFileSync(GATE, 'utf8'))
  // 把词典指向副本，否则「改词典」那几条负例根本作用不到（会静默变成假绿）。
  const redirected = mutated.replace(SEAM_ANCHOR, `const MODEL_DISPLAY_TEXT_FILE = ${JSON.stringify(seamCopy)}`)
  expect(redirected, '词典重定向锚点失效——负例验证会变成假绿，请同步更新 SEAM_ANCHOR').not.toBe(mutated)

  const gateCopy = path.join(tempDir, 'gateCopy.mjs')
  fs.writeFileSync(gateCopy, redirected)
  try {
    const stdout = execFileSync('node', [gateCopy], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, output: stdout }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('vendor 展示名翻译契约（check:i18n）', () => {
  // 阳性对照：不改任何东西必须绿。没有它，下面每条「红」都证明不了是被改动触发的
  // （门岗要是恒红，四条负例照样全过）。
  it('阳性对照：仓库现状是绿的', () => {
    const { code } = runGate()
    expect(code).toBe(0)
  })

  it('内置供应商的中文展示名没有英文说法 → 红，并指出是哪个种子', () => {
    const { code, output } = runGate({ seam: (s) => s.replace(`  火山方舟: 'Volcengine Ark',\n`, '') })
    expect(code).not.toBe(0)
    expect(output).toContain('火山方舟')
    expect(output).toContain('VOLCENGINE_VENDOR_SEED')
    expect(output).toContain('既没有英文译名,也没登记为语言中立品牌名')
  })

  // 豁免的「理由」不能只是注释——理由过期时必须自己失效。
  it('登记成语言中立品牌名的名字后来含了中文 → 豁免作废、红', () => {
    const { code, output } = runGate({
      script: (s) => s.replace(`  ['MiniMax', `, `  ['火山方舟', `),
      seam: (s) => s.replace(`  火山方舟: 'Volcengine Ark',\n`, ''),
    })
    expect(code).not.toBe(0)
    expect(output).toContain('豁免理由已失效')
  })

  it('豁免名单里挂着已不存在的供应商 → 红（名单不许烂在这儿）', () => {
    const { code, output } = runGate({ script: (s) => s.replace(`  ['Meshy', `, `  ['ThisVendorIsGone', `) })
    expect(code).not.toBe(0)
    expect(output).toContain('没有任何在册供应商种子叫这个名字')
  })

  it('已经有译名的名字还挂着豁免 → 红（多余的豁免＝死条目）', () => {
    const { code, output } = runGate({ script: (s) => s.replace(`  ['Meshy', `, `  ['本地 ComfyUI', `) })
    expect(code).not.toBe(0)
    expect(output).toContain('豁免是多余的')
  })

  // 种子名单换形状（改名/换成函数生成）会让这条门岗**静默失效**——那比漏一个译名更危险，
  // 所以解析不出来直接抛，而不是当作「零个种子」放行。
  it('BUILTIN_VENDOR_SEEDS 解析不出来 → 抛错，不静默放行', () => {
    const { code, output } = runGate({ script: (s) => s.replace(`declaration.name.text !== 'BUILTIN_VENDOR_SEEDS'`, `declaration.name.text !== 'RENAMED_AWAY'`) })
    expect(code).not.toBe(0)
    expect(output).toContain('BUILTIN_VENDOR_SEEDS')
  })
})

describe('模型展示名翻译契约（labelZh）', () => {
  it('目录里的 labelZh 中文没有英文说法 → 红', () => {
    const { code, output } = runGate({ seam: (s) => s.replace(`  '可灵 3.0': 'Kling 3.0',\n`, '') })
    expect(code).not.toBe(0)
    expect(output).toContain('可灵 3.0')
    expect(output).toContain('missing model-display translation')
  })

  // comfyuiLocal.ts 在 EXCLUDED_FILES 里（那是给「源里有中文就算漏译」那条泛化规则的豁免）。
  // 翻译契约扫描**不该**跟着一起豁免——豁免理由正是「这些标签走 model-display 边界翻译」，
  // 而边界有没有真翻正是这条扫描要验的。两处共用过滤器时，它的 labelZh 两头落空。
  it('EXCLUDED_FILES 里的档案文件，其 labelZh 仍受翻译契约约束', () => {
    const { code, output } = runGate({ seam: (s) => s.replace(`  '本地 · 文生图': 'Local · Text-to-image',\n`, '') })
    expect(code).not.toBe(0)
    expect(output).toContain('本地 · 文生图')
  })
})
