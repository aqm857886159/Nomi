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
//
// 2026-09-03 改：门岗不再对着**真仓库**跑，改为对着一份**夹具语料**跑（见 makeCorpus）。
// 为什么——门岗 main 段无条件先用 TS AST 扫全量 src/ + electron/（脚本 559-562 行），再做
// 这里真正要验的那几条契约检查；每条用例各起一次子进程 = 每条都重扫一遍全仓。8 条用例在
// 空载机器上要 58s，在并行 lane 上（本仓常年 20+ worktree 同跑）被压到 203s 并撞穿 30s 超时。
// 而这些用例要回答的问题是「门岗对情形 X 判红了吗」，**不需要**全仓语料——一份最小语料
// 就能确定性地回答，且行为逐条实测与全仓一致（1.5s vs 5.0s）。
//
// 夹具靠 ROOT = process.cwd() 这个缝生效：门岗一切路径都从 cwd 算（脚本 6-8 行），
// 所以把子进程 cwd 指到语料目录即可，无需改门岗脚本一个字。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = path.join(repoRoot, 'scripts', 'check-i18n-visible-text.mjs')
// 脚本副本必须放在能解析到 node_modules 的位置：node 解析 `import ts from 'typescript'`
// 是按**文件所在位置**往上找 node_modules 的，放 os.tmpdir() 会 ERR_MODULE_NOT_FOUND
// （实测踩过：报的是模块找不到，但退出码同样非 0，会把负例伪装成「通过」）。
// node_modules/.cache 下既能解析到依赖，又不在任何门岗的扫描范围里。
const SCRATCH_ROOT = path.join(repoRoot, 'node_modules', '.cache')

// 语料里必须给 LOCALE_NEUTRAL_VENDOR_NAMES 的每个品牌都备一个种子：门岗会验「豁免项对不上
// 任何在册种子 → 红」，少一个就会让阳性对照假红。这份名单是从门岗脚本现取的（不另抄一份，P1），
// 抄漏时阳性对照会当场红并指名道姓，不会静默漂移。
function localeNeutralVendorNames(): string[] {
  const source = fs.readFileSync(GATE, 'utf8')
  const block = source.slice(
    source.indexOf('const LOCALE_NEUTRAL_VENDOR_NAMES'),
    source.indexOf('/** 解析 BUILTIN_VENDOR_SEEDS'),
  )
  const names = [...block.matchAll(/^\s*\['([^']+)',/gm)].map((m) => m[1])
  expect(names.length, '解析不出 LOCALE_NEUTRAL_VENDOR_NAMES——语料会缺种子导致阳性对照假红').toBeGreaterThan(0)
  return names
}

/**
 * 造一份最小语料：门岗要读的四类东西各给一份真实形状的样本。
 * · 词典 modelDisplayText.ts —— 译文真相源（负例「删掉某条译文」改的就是它）
 * · 种子名单 builtinVendorSeeds.ts + 各种子文件 —— 门岗顺 import 找 name 字面量
 * · 档案 modelArchetypes/*.ts —— labelZh 翻译契约的来源
 * · electron 基线 —— 空对象即可（语料里没有主进程可见文案）
 */
function makeCorpus(root: string): void {
  for (const dir of ['src/i18n/locales', 'src/config/modelArchetypes', 'electron/catalog', 'electron/localRuntime', 'scripts']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
  }
  fs.writeFileSync(
    path.join(root, 'src/i18n/locales/modelDisplayText.ts'),
    `export const MODEL_DISPLAY_TEXT: Record<string, string> = {\n` +
      `  火山方舟: 'Volcengine Ark',\n` +
      `  本地模型: 'Local Models',\n` +
      `  '可灵 3.0': 'Kling 3.0',\n` +
      `  '本地 · 文生图': 'Local · Text-to-image',\n}\n`,
  )

  const imports: string[] = []
  const entries: string[] = []
  // 语言中立品牌名的种子（拉丁写法，本来就不该有译文）
  localeNeutralVendorNames().forEach((name, index) => {
    const identifier = `${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_VENDOR_SEED`
    const file = `neutralSeed${index}`
    fs.writeFileSync(
      path.join(root, 'electron/catalog', `${file}.ts`),
      `export const ${identifier} = { id: 'v${index}', name: ${JSON.stringify(name)} }\n`,
    )
    imports.push(`import { ${identifier} } from './${file}'`)
    entries.push(`  ${identifier},`)
  })
  // 中文展示名的种子：火山方舟 = 2026-09-02 那个洞的原样主角；
  // LOCAL_TEXT_VENDOR_SEED 住在 electron/localRuntime/（不在 catalog/ 下），
  // 保留它是为了让语料同样覆盖「按目录扫会漏掉的那个种子」这一形状。
  fs.writeFileSync(
    path.join(root, 'electron/catalog/volcengineVendorSeed.ts'),
    `export const VOLCENGINE_VENDOR_SEED = { id: 'volc', name: '火山方舟' }\n`,
  )
  fs.writeFileSync(
    path.join(root, 'electron/localRuntime/localTextVendorSeed.ts'),
    `export const LOCAL_TEXT_VENDOR_SEED = { id: 'local', name: '本地模型' }\n`,
  )
  imports.push(`import { VOLCENGINE_VENDOR_SEED } from './volcengineVendorSeed'`)
  imports.push(`import { LOCAL_TEXT_VENDOR_SEED } from '../localRuntime/localTextVendorSeed'`)
  entries.push('  VOLCENGINE_VENDOR_SEED,', '  LOCAL_TEXT_VENDOR_SEED,')
  fs.writeFileSync(
    path.join(root, 'electron/catalog/builtinVendorSeeds.ts'),
    `${imports.join('\n')}\n\nexport const BUILTIN_VENDOR_SEEDS = [\n${entries.join('\n')}\n]\n`,
  )

  fs.writeFileSync(path.join(root, 'src/config/modelArchetypes/klingArchetype.ts'), `export const KLING = { id: 'k3', labelZh: '可灵 3.0' }\n`)
  // comfyuiLocal.ts 在门岗的 EXCLUDED_FILES 里，语料沿用真名字，好让下面那条
  //「EXCLUDED_FILES 里的档案其 labelZh 仍受约束」验的是真过滤器而不是别的文件。
  fs.writeFileSync(path.join(root, 'src/config/modelArchetypes/comfyuiLocal.ts'), `export const COMFY = { id: 'ct2i', labelZh: '本地 · 文生图' }\n`)
  fs.writeFileSync(path.join(root, 'scripts/i18n-electron-baseline.json'), '{}\n')
}

let tempDir: string | null = null

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

type Mutations = { script?: (source: string) => string; seam?: (source: string) => string }

/** 跑一份（可选被改动的）门岗副本，对着夹具语料，返回退出码与合并输出。 */
function runGate({ script = (s) => s, seam = (s) => s }: Mutations = {}): { code: number; output: string } {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true })
  tempDir = fs.mkdtempSync(path.join(SCRATCH_ROOT, 'nomi-i18n-gate-'))
  const corpus = path.join(tempDir, 'corpus')
  makeCorpus(corpus)

  // 「改词典」那几条负例作用在语料的词典副本上；作用不到就会静默变成假绿，故断言改动确实落地。
  const seamFile = path.join(corpus, 'src/i18n/locales/modelDisplayText.ts')
  fs.writeFileSync(seamFile, seam(fs.readFileSync(seamFile, 'utf8')))

  const gateCopy = path.join(tempDir, 'gateCopy.mjs')
  fs.writeFileSync(gateCopy, script(fs.readFileSync(GATE, 'utf8')))

  try {
    // cwd = 语料目录：门岗的 ROOT/SRC_ROOT/ELECTRON_ROOT 全从 cwd 派生，于是只扫这几十字节。
    const stdout = execFileSync('node', [gateCopy], { cwd: corpus, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, output: stdout }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

/** 改动没落地 = 负例会假绿，所以每个 mutation 都断言它真的改到了东西。 */
const mustReplace = (from: string, to: string) => (source: string): string => {
  const next = source.replace(from, to)
  expect(next, `锚点失效，负例会变成假绿，请同步更新：${JSON.stringify(from.slice(0, 40))}`).not.toBe(source)
  return next
}

describe('vendor 展示名翻译契约（check:i18n）', () => {
  // 阳性对照：不改任何东西必须绿。没有它，下面每条「红」都证明不了是被改动触发的
  // （门岗要是恒红，四条负例照样全过）。语料版的阳性对照还多守一件事：语料本身是齐的
  // （少一个语言中立种子 / 词典缺一条，这里就会红）。
  it('阳性对照：语料现状是绿的', () => {
    const { code, output } = runGate()
    expect(code, output).toBe(0)
  })

  it('内置供应商的中文展示名没有英文说法 → 红，并指出是哪个种子', () => {
    const { code, output } = runGate({ seam: mustReplace(`  火山方舟: 'Volcengine Ark',\n`, '') })
    expect(code).not.toBe(0)
    expect(output).toContain('火山方舟')
    expect(output).toContain('VOLCENGINE_VENDOR_SEED')
    expect(output).toContain('既没有英文译名,也没登记为语言中立品牌名')
  })

  // 豁免的「理由」不能只是注释——理由过期时必须自己失效。
  it('登记成语言中立品牌名的名字后来含了中文 → 豁免作废、红', () => {
    const { code, output } = runGate({
      script: mustReplace(`  ['MiniMax', `, `  ['火山方舟', `),
      seam: mustReplace(`  火山方舟: 'Volcengine Ark',\n`, ''),
    })
    expect(code).not.toBe(0)
    expect(output).toContain('豁免理由已失效')
  })

  it('豁免名单里挂着已不存在的供应商 → 红（名单不许烂在这儿）', () => {
    const { code, output } = runGate({ script: mustReplace(`  ['Meshy', `, `  ['ThisVendorIsGone', `) })
    expect(code).not.toBe(0)
    expect(output).toContain('没有任何在册供应商种子叫这个名字')
  })

  it('已经有译名的名字还挂着豁免 → 红（多余的豁免＝死条目）', () => {
    // 语料里「本地模型」有译文，拿它顶掉 Meshy 就构成「多余豁免」。
    const { code, output } = runGate({ script: mustReplace(`  ['Meshy', `, `  ['本地模型', `) })
    expect(code).not.toBe(0)
    expect(output).toContain('豁免是多余的')
  })

  // 种子名单换形状（改名/换成函数生成）会让这条门岗**静默失效**——那比漏一个译名更危险，
  // 所以解析不出来直接抛，而不是当作「零个种子」放行。
  it('BUILTIN_VENDOR_SEEDS 解析不出来 → 抛错，不静默放行', () => {
    const { code, output } = runGate({
      script: mustReplace(`declaration.name.text !== 'BUILTIN_VENDOR_SEEDS'`, `declaration.name.text !== 'RENAMED_AWAY'`),
    })
    expect(code).not.toBe(0)
    expect(output).toContain('BUILTIN_VENDOR_SEEDS')
  })
})

describe('模型展示名翻译契约（labelZh）', () => {
  it('目录里的 labelZh 中文没有英文说法 → 红', () => {
    const { code, output } = runGate({ seam: mustReplace(`  '可灵 3.0': 'Kling 3.0',\n`, '') })
    expect(code).not.toBe(0)
    expect(output).toContain('可灵 3.0')
    expect(output).toContain('missing model-display translation')
  })

  // comfyuiLocal.ts 在 EXCLUDED_FILES 里（那是给「源里有中文就算漏译」那条泛化规则的豁免）。
  // 翻译契约扫描**不该**跟着一起豁免——豁免理由正是「这些标签走 model-display 边界翻译」，
  // 而边界有没有真翻正是这条扫描要验的。两处共用过滤器时，它的 labelZh 两头落空。
  it('EXCLUDED_FILES 里的档案文件，其 labelZh 仍受翻译契约约束', () => {
    const { code, output } = runGate({ seam: mustReplace(`  '本地 · 文生图': 'Local · Text-to-image',\n`, '') })
    expect(code).not.toBe(0)
    expect(output).toContain('本地 · 文生图')
  })
})
