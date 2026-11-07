import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { require as tsxRequire } from 'tsx/cjs/api'
import ts from 'typescript'

import { repoWriteViolations } from './lib/repoWriteScan.mjs'
import { scanSystemTempBypasses, systemTempBypasses } from './lib/systemTempScan.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = ['scripts', 'tests']
const sourcePattern = /\.(?:node-test|test|walk|e2e|probe|paid)\.m?js$/
const helperCall = /\b(?:makeTempDir|makeTempDirAsync|registerTempRoot|cleanupTempRoot)\s*\(/g
const forbiddenQualifiedHelperCall = /\b[A-Za-z_$][\w$]*\.(?:makeTempDir|makeTempDirAsync|registerTempRoot|cleanupTempRoot)\s*\(/g

// 永久豁免：直接在系统临时目录建目录、并且必须这样的两处（每条写理由；下面有测试要求它们真的还在被扫到，否则是死豁免，删掉）。
// 其余的绕过都是存量，登记在 scripts/test-temp-bypass-baseline.json，只减不增。
const SYSTEM_TEMP_EXEMPT = {
  'scripts/_test-temp.mjs': 'the shared helper is the single system-temp allocation boundary',
  'tests/setup/tempWorkspace.ts': 'Vitest global setup owns the run TMPDIR and its direct allocation is the workspace contract',
}
const BASELINE_FILE = 'scripts/test-temp-bypass-baseline.json'

function filesUnder(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if ((root === 'scripts' ? /\.(?:mjs|ts)$/.test(entry.name) : sourcePattern.test(entry.name))) out.push(full)
    }
  }
  walk(path.join(repoRoot, root))
  return out
}

// ---- 系统临时目录只有一个分配口（2026-10-28 换成语法树判据 + 只减不增的基线）----
// 唯一分配口 scripts/_test-temp.mjs 的目录名带创建者进程号，被 SIGKILL 杀掉后下一个进程 / 杀它的 runner 会按进程号回收；
// 绕开它直接 mkdtemp(<系统临时目录>) 建出来的目录没有归属，进程一被杀就永远留在盘上（10-24 到 10-28 漏 10 份、约 8.6G）。
// 判据与已知限制见 scripts/lib/systemTempScan.mjs；范围是 scripts/ 与 tests/ 下全部 JS / TS 源码（旧门岗只认五个固定写法的正则、
// 只扫 tests/ 下带 .test/.walk/.e2e/.probe/.paid 后缀的 .mjs，.cjs / .mts / 别名 / process.env.TMPDIR 全漏）。
const bypasses = scanSystemTempBypasses(repoRoot, roots)
const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, BASELINE_FILE), 'utf8'))

test('scripts/ 与 tests/ 里没有新的绕过：直接 mkdtemp(系统临时目录) 的处数不超过基线，没登记的文件一处都不许有', () => {
  const violations = []
  for (const [file, hits] of bypasses) {
    if (Object.hasOwn(SYSTEM_TEMP_EXEMPT, file)) continue
    const allowed = baseline[file] ?? 0
    if (hits.length > allowed) violations.push(`${file}（${hits.length} 处，基线 ${allowed}）：${hits.map((hit) => `第 ${hit.line} 行 ${hit.call}`).join('；')}`)
  }
  assert.deepEqual(violations, [], `绕开 scripts/_test-temp.mjs 直接在系统临时目录建目录——这样的目录没有创建者进程号，进程被杀后永远没人回收。改用 makeTempDir / makeTempDirAsync，不要往基线里加：\n${violations.join('\n')}`)
})

test('基线只减不增：登记过的绕过少了或文件没了，就在同一提交里把基线改小 / 删掉那一行', () => {
  const stale = Object.entries(baseline).flatMap(([file, allowed]) => {
    const actual = bypasses.get(file)?.length ?? 0
    return actual < allowed ? [`${file}：基线 ${allowed} 处，现在只有 ${actual} 处`] : []
  })
  assert.deepEqual(stale, [], `${BASELINE_FILE} 里有已经清掉的存量，把它们改小 / 删掉（基线是棘轮，只减不增）：\n${stale.join('\n')}`)
})

test('基线本身的形状：键是 scripts/ 或 tests/ 下的源码文件，值是正整数，不含永久豁免的文件', () => {
  for (const [file, allowed] of Object.entries(baseline)) {
    assert.match(file, /^(?:scripts|tests)\/.+\.(?:[cm]?[jt]sx?)$/, `${file} 不是 scripts/ 或 tests/ 下的源码文件`)
    assert.ok(Number.isInteger(allowed) && allowed > 0, `${file} 的值要是正整数（清零就删掉这一行）：${allowed}`)
    assert.equal(Object.hasOwn(SYSTEM_TEMP_EXEMPT, file), false, `${file} 是永久豁免，不该再进基线`)
  }
})

test('永久豁免的文件都写着理由，并且真的还在直接建系统临时目录（否则是死豁免，删掉）', () => {
  for (const [file, reason] of Object.entries(SYSTEM_TEMP_EXEMPT)) {
    assert.ok(reason.length > 0, `${file} 没写理由`)
    assert.ok(fs.existsSync(path.join(repoRoot, file)), `${file} 不存在了，从豁免里删掉`)
    assert.ok((bypasses.get(file)?.length ?? 0) > 0, `${file} 已经不再直接 mkdtemp(系统临时目录)，这条豁免是死的，删掉`)
  }
})

test('必红：绕开分配口的各种写法都认得出（限定写法、模板串、别名、参数默认值、process.env、/tmp 字面量、动态 import 的 mkdtemp）', () => {
  const red = [
    "fs.mkdtempSync(path.join(os.tmpdir(), 'x-'))",
    "await fs.promises.mkdtemp(path.join(os.tmpdir(), 'x-'))",
    "await fsp.mkdtemp(join(tmpdir(), 'x-'))",
    "mkdtempSync(join(tmpdir(), 'x-'))",
    "fs['mkdtempSync'](path.join(os.tmpdir(), 'x-'))",
    'fs.mkdtempSync(`${os.tmpdir()}/x-`)',
    "nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'x-'))",
    "fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'x-'))",
    "const tmp = os.tmpdir()\nfs.mkdtempSync(path.join(tmp, 'x-'))",
    "const tmp = fs.realpathSync(os.tmpdir())\nconst base = path.join(tmp, 'nomi')\nfs.mkdtempSync(path.join(base, 'x-'))",
    "function make(base = os.tmpdir()) { return fs.mkdtempSync(path.join(base, 'x-')) }",
    "fs.mkdtempSync(path.join(process.env.TMPDIR || process.env.TEMP || '.', 'x-'))",
    "fs.mkdtempSync(path.join(process.env['TEMP'] ?? os.tmpdir(), 'x-'))",
    "fs.mkdtempSync('/tmp/nomi-regression-')",
    "fs.mkdtempSync('/var/tmp/x-')",
    "fs.mkdtempSync(`/private/tmp/${name}-`)",
    "import { mkdtemp } from 'node:fs/promises'\nawait mkdtemp(path.join(tmpdir(), 'x-'))",
  ]
  for (const source of red) assert.ok(systemTempBypasses('x.mjs', source).length > 0, source)
  // .cjs / .mts / .tsx 一样看得见
  for (const file of ['x.cjs', 'x.mts', 'x.cts', 'x.ts', 'x.tsx', 'x.jsx']) {
    assert.equal(systemTempBypasses(file, "const d = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'))").length, 1, file)
  }
})

test('放行：非系统临时目录（仓库内 .tmp、调用方给的目录、走共享助手）和注释 / 字符串里写的不算；别处同名的变量不受牵连', () => {
  const green = [
    "fs.mkdtempSync(path.join(repoRoot, '.tmp', 'x-'))",
    "fs.mkdtempSync(path.join(root, '.tmp/anchor-real-planner-'))",
    "fs.mkdtempSync(path.join(outputDir, 'attempt-'))",
    "const root = makeTempDir('x-')\nfs.mkdtempSync(path.join(root, 'sub-'))",
    "// fs.mkdtempSync(path.join(os.tmpdir(), 'x-'))",
    "const text = \"fs.mkdtempSync(path.join(os.tmpdir(), 'x-'))\"",
    "const dir = os.tmpdir()\nconsole.log(dir)",
    "fs.mkdtempSync(prefix)",
    // 别的函数里的同名变量是仓库内目录：按词法作用域跟别名，不按名字全文件通配
    "function a() { const root = os.tmpdir(); return root }\nfunction b() { const root = path.join(repoRoot, '.tmp'); return fs.mkdtempSync(path.join(root, 'x-')) }",
  ]
  for (const source of green) assert.deepEqual(systemTempBypasses('x.mjs', source), [], source)
})

test('必红的计数：同一个文件里每一处都算，基线按处数比（登记 1 处不能顺带放过第 2 处）', () => {
  const source = [
    "const a = fs.mkdtempSync(path.join(os.tmpdir(), 'a-'))",
    "const b = fs.mkdtempSync(path.join(os.tmpdir(), 'b-'))",
  ].join('\n')
  assert.deepEqual(systemTempBypasses('x.mjs', source).map((hit) => hit.line), [1, 2])
})

test('every shared temp helper call has an import and no qualified helper call', () => {
  const missingImports = []
  const qualifiedCalls = []
  for (const file of roots.flatMap(filesUnder)) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/')
    if (rel === 'scripts/_test-temp.mjs' || rel === 'scripts/check-test-temp-static.node-test.mjs') continue
    const source = fs.readFileSync(file, 'utf8')
    if (source.match(helperCall) && !/from ['"][^'\"]*_test-temp\.mjs['"]/.test(source)) missingImports.push(rel)
    if (forbiddenQualifiedHelperCall.test(source)) qualifiedCalls.push(rel)
    forbiddenQualifiedHelperCall.lastIndex = 0
  }
  assert.deepEqual(missingImports, [], `helper calls without shared helper imports: ${missingImports.join(', ')}`)
  assert.deepEqual(qualifiedCalls, [], `qualified shared helper calls remain: ${qualifiedCalls.join(', ')}`)
})

test('walkthrough scripts are included in the static scan', () => {
  const files = filesUnder('scripts').map((file) => path.relative(repoRoot, file).split(path.sep).join('/'))
  assert.ok(files.includes('scripts/settings-autosave-walkthrough.mjs'))
  assert.ok(files.includes('scripts/asset-preview-walkthrough.mjs'))
})

// ---- 测试不许往真实仓库路径写（2026-10-10：gate-mutation-harness 原地改生产文件，被杀后留下变异代码）----
// 判据与限制见 scripts/lib/repoWriteScan.mjs。范围：scripts/ 与 tests/ 下的 *.node-test.* / *.test.*（走查的 .walk/.e2e 写的是证据截图目录，不在此列），
// 加上共用装置 gate-mutation-harness.mjs 本身。要写文件就写 makeTempDir 给的临时目录。
const repoWriteScopePattern = /\.(?:node-test|test)\.(?:m?js|cjs|ts)$/
const repoWriteExtraFiles = ['scripts/gate-mutation-harness.mjs']

// 允许往仓库里写的少数例外：只写「不入库的新文件」，从不改写、删除被跟踪文件，没有“写坏再还原”的窗口。
const REPO_WRITE_ALLOWLIST = {
  'tests/experience-laws/parameterReachability.test.mjs': '写 gitignore 的 artifacts/ 下的覆盖表（证据产物，非源码）',
}

function repoWriteScopeFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (repoWriteScopePattern.test(entry.name)) out.push(full)
    }
  }
  for (const root of roots) walk(path.join(repoRoot, root))
  for (const rel of repoWriteExtraFiles) out.push(path.join(repoRoot, rel))
  return out
}

test('测试与门岗自检装置不往真实仓库路径写文件（写 repoRoot 下非 .tmp 的路径就红）', () => {
  const violations = []
  for (const file of repoWriteScopeFiles()) {
    if (Object.hasOwn(REPO_WRITE_ALLOWLIST, path.relative(repoRoot, file).split(path.sep).join('/'))) continue
    for (const hit of repoWriteViolations(file, fs.readFileSync(file, 'utf8'))) {
      violations.push(`${path.relative(repoRoot, file).split(path.sep).join('/')}:${hit.line} ${hit.call}`)
    }
  }
  assert.deepEqual(violations, [], `这些调用往真实仓库路径写：\n${violations.join('\n')}\n改成写 makeTempDir 的临时目录（门岗自检用 scripts/gate-mutation-harness.mjs 的副本）`)
})

test('必红：往 repoRoot / process.cwd() 下写 / 删 / 建目录 / 拷贝目标 / 改名', () => {
  const red = [
    "fs.writeFileSync(path.join(repoRoot, 'electron/a.ts'), 'x')",
    "writeFileSync(path.join(REPO_ROOT, rel), content)",
    "fs.rmSync(path.join(repoRoot, 'scripts/recovery.json'), { force: true })",
    "fs.mkdirSync(path.join(repoRoot, 'out'), { recursive: true })",
    "fs.copyFileSync(source, path.join(repoRoot, 'electron/a.ts'))",
    "fs.cpSync(tempDir, path.join(repoRoot, 'electron'), { recursive: true })",
    "fs.renameSync(path.join(tempDir, 'a'), path.join(repoRoot, 'a'))",
    "fs.writeFileSync(path.resolve(process.cwd(), 'package.json'), '{}')",
    // 事故原型：gate-mutation-harness 改造前的 withMutation / 还原
    "for (const [relative, content] of originals) fs.writeFileSync(path.join(repoRoot, relative), content)",
  ]
  for (const source of red) assert.ok(repoWriteViolations('x.test.mjs', source).length > 0, source)
})

test('放行：写临时目录、写 .tmp 草稿区、只把真实仓库当拷贝来源', () => {
  const green = [
    "fs.writeFileSync(path.join(tempDir, 'a.ts'), 'x')",
    "fs.writeFileSync(path.join(repoRoot, '.tmp', 'x.json'), '{}')",
    "fs.mkdirSync(path.join(repoRoot, '.tmp-gen-1'))",
    "fs.copyFileSync(path.join(repoRoot, 'scripts/a.mjs'), path.join(tempDir, 'a.mjs'))",
    "fs.cpSync(path.join(repoRoot, 'electron'), path.join(tempDir, 'electron'), { recursive: true })",
    "fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')",
  ]
  for (const source of green) assert.deepEqual(repoWriteViolations('x.test.mjs', source), [], source)
})

test('变量别名也算：先把真仓库路径赋给变量、再写该变量（check-ipc-sender-binding 事故原型）→ 红；别处同名的临时目录变量不受牵连', () => {
  const red = `
    const target = path.join(process.cwd(), 'electron', 'main.ts')
    fs.writeFileSync(target, 'x')`
  assert.ok(repoWriteViolations('x.test.mjs', red).length > 0)
  const redViaChain = `
    const base = path.join(repoRoot, 'electron')
    const target = path.join(base, 'main.ts')
    fs.rmSync(target)`
  assert.ok(repoWriteViolations('x.test.mjs', redViaChain).length > 0)
  const greenOtherScope = `
    function a() { const root = path.join(repoRoot, 'x'); return fs.readFileSync(root) }
    function b() { const root = makeTempDir('x-'); fs.writeFileSync(path.join(root, 'a'), '1') }`
  assert.deepEqual(repoWriteViolations('x.test.mjs', greenOtherScope), [])
  const greenTmp = `
    const scratch = path.join(repoRoot, '.tmp', 'x')
    fs.writeFileSync(scratch, '1')`
  assert.deepEqual(repoWriteViolations('x.test.mjs', greenTmp), [])
})

// ---- 走查 / 评测不碰用户真实资料（2026-10-24，夜跑 run 40035294026；N-nightly 第 2 轮并入）----
// 两条，都只看代码里真正的字符串与路径表达式（注释里写一句跑法不算）。单元测试（*.test.* / *.node-test.*）注入的是
// 假主目录或打桩的 os.homedir()，不在范围里。
//   1. tests/ux 下的脚本不许写死某个用户主目录下的绝对路径（/Users/<名>/…、/home/<名>/…、C:\Users\<名>\…）。
//      起因：三条参数栏 / 新模型走查把作者本机「文稿/Nomi Projects」里一个真实项目写死当模板——夜跑上 ENOENT，
//      作者本机上读的是用户真实的项目。机器相关的位置走环境变量，真实资料目录只问 owner tests/ux/_realProfile.mjs。
//   2. 不许读真实宿主配置：tests/、evals/ 下的脚本，以及 scripts/ 下起 App 的脚本（import 了 _launchApp.mjs /
//      isoApp.mjs），不许从真实主目录（os.homedir()、HOME / USERPROFILE / APPDATA / XDG_CONFIG_HOME）或宿主自己的
//      位置变量（CLAUDE_CONFIG_DIR / CODEX_HOME）拼出指进宿主配置位置的路径。宿主位置不在这里手抄：按注册表
//      electron/shared/mcpClientRegistry.ts 的每一条（三平台、配置文件 + 安装痕迹）用哨兵根算出来，新宿主自动盖到。
//      要宿主配置就在临时主目录里摆假的；真宿主上的核对归 tests/system/mcp-real-client.mjs（按指纹，不改写）。
//      起因：隔离起的 App 读到真 ~/.claude.json（启动器那半由 tests/ux/_launchApp.test.mjs 守）；走查里还有拿真
//      ~/.codex/generated_images 当素材、把真 ~/.workbuddy 链进假主目录写完再还原的。
// 已知限制：语法层；跨函数传进来的路径看不到（同文件里由真实主目录赋值的变量会跟）。
const UNIT_TEST_FILE = /\.(?:node-)?test\.|\.spec\./
const HOME_PATH = /(?:^|[^A-Za-z0-9_])(?:\/Users\/|\/home\/)[^/\\\s'"`]+\/|(?:^|[^A-Za-z0-9_])[A-Za-z]:(?:\\|\/)+Users(?:\\|\/)+[^\\/\s'"`]+(?:\\|\/)/
const isHomePath = (text) => HOME_PATH.test(text)

/** 一份脚本里的全部字符串字面量（含模板串各段）。 */
function stringLiterals(text, fileName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
  const strings = []
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      strings.push({ text: node.text, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return strings
}

const hostRegistry = tsxRequire('../electron/shared/mcpClientRegistry.ts', import.meta.url)
/** 真实环境里的根换成哨兵：主目录、APPDATA、XDG_CONFIG_HOME、每个宿主变量各一个。 */
const SENTINEL_HOME = '/HOME'
const ENV_ROOTS = {
  HOME: SENTINEL_HOME,
  USERPROFILE: SENTINEL_HOME,
  APPDATA: '/APPDATA',
  XDG_CONFIG_HOME: '/XDG',
  ...Object.fromEntries(hostRegistry.MCP_CLIENT_HOST_ENV_VARS.map((name) => [name, `/HOSTENV/${name}`])),
}
/** 注册表每一条宿主位置在哨兵根下的样子（不设变量的默认位置、APPDATA / XDG 下的、宿主变量下的）。 */
const HOST_LOCATIONS = [...new Set(hostRegistry.mcpClientLocations().flatMap(({ platform, location }) =>
  [{}, ENV_ROOTS].map((env) => hostRegistry.resolveMcpClientPath(location, { platform, env, homedir: SENTINEL_HOME, join: path.posix.join }))))]

function envName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text
  return null
}
const isProcessEnv = (node) => ts.isPropertyAccessExpression(node) && node.name.text === 'env' && ts.isIdentifier(node.expression) && node.expression.text === 'process'

/** 这段表达式要是「真实环境里的某个根」，给出它的哨兵；否则 null。 */
function realRoot(node, aliases) {
  if (ts.isParenthesizedExpression(node)) return realRoot(node.expression, aliases)
  if (ts.isIdentifier(node)) return aliases.get(node.text) ?? null
  if (ts.isCallExpression(node) && node.arguments.length === 0) {
    const callee = node.expression
    if ((ts.isIdentifier(callee) && callee.text === 'homedir') || (ts.isPropertyAccessExpression(callee) && callee.name.text === 'homedir')) return SENTINEL_HOME
  }
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'homedir' && ts.isCallExpression(node.expression)) return SENTINEL_HOME
  if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isProcessEnv(node.expression)) {
    const name = envName(node)
    return name && Object.hasOwn(ENV_ROOTS, name) ? ENV_ROOTS[name] : null
  }
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
    return realRoot(node.left, aliases) ?? realRoot(node.right, aliases)
  }
  return null
}

/** 由真实根拼出来的路径（只取紧跟根的字面量段）；不是这种路径就 null。 */
function rootedPath(node, aliases) {
  const literal = (arg) => (ts.isStringLiteralLike(arg) ? arg.text : null)
  if (ts.isCallExpression(node) && node.arguments.length > 0) {
    const callee = node.expression
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null
    if (name !== 'join' && name !== 'resolve') return null
    const root = realRoot(node.arguments[0], aliases)
    if (!root) return null
    const segments = []
    for (const arg of node.arguments.slice(1)) {
      const text = literal(arg)
      if (text === null) break
      segments.push(text)
    }
    return path.posix.join(root, ...segments.map((segment) => segment.replaceAll('\\', '/')))
  }
  if (ts.isTemplateExpression(node) && node.head.text === '') {
    const root = realRoot(node.templateSpans[0].expression, aliases)
    return root ? path.posix.join(root, node.templateSpans[0].literal.text.replaceAll('\\', '/')) : null
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && ts.isStringLiteralLike(node.right)) {
    const root = realRoot(node.left, aliases)
    return root ? path.posix.join(root, node.right.text.replaceAll('\\', '/')) : null
  }
  return null
}

const insideHostLocation = (target) => HOST_LOCATIONS.some((location) => {
  const relative = path.posix.relative(location, target)
  return relative === '' || (!relative.startsWith('..') && !path.posix.isAbsolute(relative))
})

/** 一份脚本里指进真实宿主配置位置的路径表达式，和对宿主位置变量的直接读取。 */
function realHostConfigReads(text, fileName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
  const aliases = new Map()
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const root = realRoot(node.initializer, aliases)
      if (root) aliases.set(node.name.text, root)
    }
    ts.forEachChild(node, collect)
  }
  collect(source)
  const hits = []
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1
  const visit = (node) => {
    const target = rootedPath(node, aliases)
    if (target && insideHostLocation(target)) hits.push({ line: lineOf(node), detail: target })
    else if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isProcessEnv(node.expression)
      && hostRegistry.MCP_CLIENT_HOST_ENV_VARS.includes(envName(node))) hits.push({ line: lineOf(node), detail: `process.env.${envName(node)}` })
    ts.forEachChild(node, visit)
  }
  visit(source)
  return hits
}

function scriptsUnder(relativeRoot, filter = () => true) {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'shots' || entry.name === '__shots__' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(?:mjs|cjs|js|ts|mts|cts)$/.test(entry.name) && !UNIT_TEST_FILE.test(entry.name)) {
        const rel = path.relative(repoRoot, full).split(path.sep).join('/')
        if (filter(rel)) out.push(rel)
      }
    }
  }
  walk(path.join(repoRoot, relativeRoot))
  return out
}

test('tests/ux 下的脚本不写死用户主目录下的绝对路径', () => {
  const violations = scriptsUnder('tests/ux', (rel) => /\.(?:mjs|cjs|js)$/.test(rel)).flatMap((rel) =>
    stringLiterals(fs.readFileSync(path.join(repoRoot, rel), 'utf8'), rel)
      .filter((entry) => isHomePath(entry.text))
      .map((entry) => `${rel}:${entry.line} ${entry.text.slice(0, 120)}`))
  assert.deepEqual(violations, [], '机器相关的位置走环境变量；真实资料目录只问 tests/ux/_realProfile.mjs')
})

test('写死的主目录路径：字符串和模板串里算，注释里不算', () => {
  const flagged = (code) => stringLiterals(code, 'walk.mjs').some((entry) => isHomePath(entry.text))
  assert.equal(flagged("const p = '/Users/aoqimin/Documents/Nomi Projects/x/.nomi/project.json'"), true)
  assert.equal(flagged('const p = `/home/someone/${name}/a.json`'), true)
  assert.equal(flagged("const p = 'C:\\\\Users\\\\me\\\\AppData\\\\Roaming\\\\nomi'"), true)
  assert.equal(flagged('// 跑法：export NOMI_REAL_MEDIA_DIR="/Users/aoqimin/Desktop/视频/"\nconst dir = process.env.NOMI_REAL_MEDIA_DIR'), false)
})

test('走查 / 评测 / 起 App 的脚本不从真实主目录或宿主变量拼出宿主配置路径', () => {
  const launchesApp = (rel) => /from\s+['"][^'"]*(?:_launchApp|isoApp)\.mjs['"]/.test(fs.readFileSync(path.join(repoRoot, rel), 'utf8'))
  const files = [...scriptsUnder('tests'), ...scriptsUnder('evals'), ...scriptsUnder('scripts', launchesApp)]
  const violations = files.flatMap((rel) => realHostConfigReads(fs.readFileSync(path.join(repoRoot, rel), 'utf8'), rel)
    .map((hit) => `${rel}:${hit.line} → ${hit.detail}`))
  assert.deepEqual(violations, [], '宿主配置在临时主目录里摆假的；真宿主上的核对归 tests/system/mcp-real-client.mjs')
})

test('宿主配置路径的认法：各种拼法都认得出，临时主目录、Nomi 自己的目录、注释和展示文案不算', () => {
  const hits = (code) => realHostConfigReads(code, 'walk.mjs').map((hit) => hit.detail)
  const red = [
    "path.join(os.homedir(), '.codex', 'generated_images')",
    "fs.symlinkSync(path.join(os.homedir(), '.workbuddy'), dir)",
    "join(homedir(), '.claude.json')",
    'const p = `${os.homedir()}/.cursor/mcp.json`',
    "const p = os.homedir() + '/.claude'",
    "path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json')",
    "path.join(os.homedir(), 'Library', 'Application Support', 'Claude')",
    "const home = os.homedir()\nfs.readFileSync(path.join(home, '.codex', 'config.toml'))",
    "path.resolve(process.env.HOME || os.homedir(), '.cursor')",
    "path.join(os.userInfo().homedir, '.claude', 'settings.json')",
    'const dir = process.env.CODEX_HOME',
    "path.join(process.env['CLAUDE_CONFIG_DIR'], '.claude.json')",
  ]
  for (const code of red) assert.ok(hits(code).length > 0, code)
  const green = [
    "path.join(testHome, '.claude.json')",
    "path.join(os.homedir(), 'Library', 'Application Support', 'nomi')",
    "path.join(os.homedir(), '.claudex')",
    "// 真机上是 path.join(os.homedir(), '.codex')\nconst shown = '~/.claude.json'",
    'const home = os.homedir()',
    "const env = { HOME: testHome, CODEX_HOME: path.join(tempRoot, 'codex') }",
  ]
  for (const code of green) assert.deepEqual(hits(code), [], code)
})

test('宿主位置按注册表算：注册表里每一条主目录下的位置（三平台、配置文件 + 安装痕迹），从 os.homedir() 拼过去都认得出', () => {
  const homeLocations = hostRegistry.mcpClientLocations().filter(({ location }) => location.root === 'home')
  assert.ok(homeLocations.length > 0)
  for (const { client, location } of homeLocations) {
    const code = `path.join(os.homedir(), ${location.segments.map((segment) => JSON.stringify(segment)).join(', ')})`
    assert.ok(realHostConfigReads(code, 'walk.mjs').length > 0, `${client}: ${code}`)
  }
  for (const name of hostRegistry.MCP_CLIENT_HOST_ENV_VARS) assert.ok(realHostConfigReads(`process.env.${name}`, 'walk.mjs').length > 0, name)
})
