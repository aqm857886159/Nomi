// T-8 结构防错 ESLint 规则组（Categories 2 & 3 + 3 道原独立推送前快检迁移）。
//
// 为什么收进 ESLint + 独立只减不增基线（scripts/t8-structural-guards-baseline.json）：
//   · 独立规则 id（syntaxPlugin()）不被后面 flat-config 块覆盖；
//   · 存量债冻结在 scripts/t8-structural-guards-baseline.json（不碰 eslint-suppressions.json，
//     避免与其他 PR 冲突或阻塞推送前钩子）；同文件不许再增第 2 处、修完必须收紧由
//     scripts/t8-structural-guards.node-test.mjs 的精确计数棘轮测试严格核对（实际命中数 === count）；
//   · 同时把 check:main-console / check:renderer-sync-ipc / check:builtin-vendor-literals
//     三道单文件纯语法门岗收进 ESLint，使本地推送前门岗总数净减（不涨反降）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinRules } from 'eslint/use-at-your-own-risk'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const T8_BASELINE_PATH = 'scripts/t8-structural-guards-baseline.json'

export function loadT8Baseline(root = REPO_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, T8_BASELINE_PATH), 'utf8'))
}

const syntaxPlugin = () => ({ rules: { 'no-restricted-syntax': builtinRules.get('no-restricted-syntax') } })

const TEST_IGNORES = [
  '**/*.test.{ts,tsx,mts,cts}',
  '**/*.spec.{ts,tsx,mts,cts}',
  '**/*.e2e.{ts,tsx,mts,cts}',
  '**/__tests__/**',
  '**/__fixtures__/**',
  '**/testSupport/**',
  '**/*TestUtils.ts',
  '**/*.testkit.ts',
]

const FS_MODULE = '/^(node:)?fs(\\/promises)?$/'

// ── 1. 第 2 类：禁止在已有/新增产品文件里直接调 fs.watch / fs.watchFile ─────────────────────────────
export const GENERIC_FS_WATCH_MESSAGE =
  '不要在业务文件直接调 fs.watch / fs.watchFile（句柄泄漏 + 跨平台抖动 + 与 stat 双失效）：单活跃目录用轻量 stat/lstat 指纹，确需全局监听须登记唯一主人。'
export const genericFsWatchSelectors = [
  {
    selector: 'CallExpression > MemberExpression.callee[property.name=/^(watch|watchFile)$/][object.name=/^(fs|fsp|nodeFs|fsPromises)$/]',
    message: GENERIC_FS_WATCH_MESSAGE,
  },
  {
    selector: 'CallExpression > MemberExpression.callee[property.name=/^(watch|watchFile)$/][object.property.name="promises"]',
    message: GENERIC_FS_WATCH_MESSAGE,
  },
  {
    selector: `ImportDeclaration[source.value=${FS_MODULE}] > ImportSpecifier[imported.name=/^(watch|watchFile)$/]`,
    message: GENERIC_FS_WATCH_MESSAGE,
  },
]

// ── 2. 第 2 类：禁止在业务文件手写 Map FIFO/LRU 淘汰缓存（*.keys().next()）──────────────────────────
export const GENERIC_MAP_EVICTION_MESSAGE =
  '不要在业务文件里再手写一份 Map.keys().next() FIFO/LRU 淘汰缓存：渲染层优先用已装的 swr，主进程收口到唯一有界缓存主人（存量冻结在 scripts/t8-structural-guards-baseline.json，只减不增）。'
export const genericMapEvictionSelectors = [
  {
    selector: 'CallExpression > MemberExpression.callee[property.name="next"] > CallExpression.object > MemberExpression.callee[property.name="keys"]',
    message: GENERIC_MAP_EVICTION_MESSAGE,
  },
]

// ── 3. 第 2 类：禁止在 electron/jsonFile.ts 之外裸调 fs.renameSync / fsp.rename ─────────────────────
export const GENERIC_RAW_RENAME_MESSAGE =
  '主进程文件原子改名只经 electron/jsonFile.ts（Windows EPERM/EBUSY 共享冲突重试唯一主人）：改调 renameSyncWithRetry / writeJsonAtomic，不要裸调 fs.renameSync / fsp.rename。'
export const genericRawRenameSelectors = [
  {
    selector: 'CallExpression > MemberExpression.callee[property.name=/^(rename|renameSync)$/][object.name=/^(fs|fsp|nodeFs|fsPromises)$/]',
    message: GENERIC_RAW_RENAME_MESSAGE,
  },
  {
    selector: 'CallExpression > MemberExpression.callee[property.name="rename"][object.property.name="promises"]',
    message: GENERIC_RAW_RENAME_MESSAGE,
  },
  {
    selector: `ImportDeclaration[source.value=${FS_MODULE}] > ImportSpecifier[imported.name=/^(rename|renameSync)$/]`,
    message: GENERIC_RAW_RENAME_MESSAGE,
  },
]

// ── 4. 第 2 类：禁止非重试主人在 for/while 中手写指数退避重试循环 ─────────────────────────────────────
export const GENERIC_RETRY_LOOP_MESSAGE =
  '不要在业务文件手写带指数退避（Math.pow(2, …) / ** / delay * 2）的重试循环：复用既有重试主人（electron/sharingRetry.ts、electron/vendor/vendorHttp.ts、scripts/lib/transientRetry.mjs）或现成库。'
const LOOP_SCOPE = ':matches(ForStatement, WhileStatement)'
const EXPONENTIAL_EXPR = ':matches(CallExpression[callee.object.name="Math"][callee.property.name="pow"][arguments.0.value=2], BinaryExpression[operator="**"][left.value=2], BinaryExpression[operator="*"][right.value=2][left.name=/delay|backoff|wait|interval/i])'
const ASYNC_SLEEP_EXPR = ':matches(AwaitExpression CallExpression[callee.name=/^(sleep|delay|wait|waitMs|waitForRetry)$/], NewExpression[callee.name="Promise"] CallExpression[callee.name="setTimeout"])'
export const genericRetryLoopSelectors = [
  {
    selector: `${LOOP_SCOPE}:has(${EXPONENTIAL_EXPR}):has(${ASYNC_SLEEP_EXPR})`,
    message: GENERIC_RETRY_LOOP_MESSAGE,
  },
  {
    // #1409 形状：Map 维护 retryDelay 并手写 Math.min(delay * 2, MAX) 指数退避
    selector: 'CallExpression[callee.object.name="Math"][callee.property.name="min"] BinaryExpression[operator="*"][right.value=2][left.name=/delay|backoff|retry/i]',
    message: GENERIC_RETRY_LOOP_MESSAGE,
  },
]

// ── 5. 第 3 类：上游余额/配额错误归类唯一主人（electron/shared/vendorFailure.ts）─────────────────────
export const VENDOR_FAILURE_ONE_HOME_MESSAGE =
  '上游余额 / 配额错误归类只住 electron/shared/vendorFailure.ts（categorizeVendorFailure）：不要在其它文件新增匹配 insufficient_quota / 余额不足 的第二层正则或分类表。'
export const vendorFailureOneHomeSelectors = [
  {
    selector: 'Literal[regex.pattern=/insufficient_quota|insufficient_user_quota|pre_consume_token_quota_failed|余额不足|额度不足/]',
    message: VENDOR_FAILURE_ONE_HOME_MESSAGE,
  },
  {
    selector: 'Literal[value=/^(?:insufficient_quota|insufficient_user_quota|pre_consume_token_quota_failed)$/]',
    message: VENDOR_FAILURE_ONE_HOME_MESSAGE,
  },
]

// ── 6. 第 3 类：禁止同模块内同时用 fs.watch 与 stat/lstat 做双失效（回放 #1618）───────────────────────
export const DUAL_INVALIDATION_MESSAGE =
  '不要在同一模块里同时用 fs.watch / watchFile 和 stat / lstat 做两套失效判定（双层失效互相掩盖缺陷）：单活跃目录只保留 stat/lstat 指纹这一套。'
const HAS_WATCH_IN_PROGRAM = ':matches(CallExpression[callee.property.name=/^(watch|watchFile)$/], ImportDeclaration[source.value=/^(node:)?fs(\\/promises)?$/] > ImportSpecifier[imported.name=/^(watch|watchFile)$/])'
const HAS_STAT_IN_PROGRAM = ':matches(CallExpression[callee.property.name=/^(stat|lstat|statSync|lstatSync)$/], CallExpression[callee.name=/^(stat|lstat|statSync|lstatSync)$/])'
export const dualInvalidationSelectors = [
  {
    selector: `Program:has(${HAS_WATCH_IN_PROGRAM}):has(${HAS_STAT_IN_PROGRAM})`,
    message: DUAL_INVALIDATION_MESSAGE,
  },
]

// ── 7. 迁自 check:main-console：主进程硬零禁止 console.* 调用 ──────────────────────────────────────
export const MAIN_CONSOLE_MESSAGE =
  '主进程禁止直接调 console.*（打包后丢证据）：改用 electron/logging/logger.ts 的 logInfo / logWarn / logError / logVendorCall / logDevDetail。'
export const mainConsoleSelectors = [
  {
    selector: 'CallExpression > MemberExpression.callee[object.name="console"]',
    message: MAIN_CONSOLE_MESSAGE,
  },
]

// ── 8. 迁自 check:renderer-sync-ipc：preload 禁止新增同步 IPC（sendSync / invokeSync）────────────────
export const RENDERER_SYNC_IPC_MESSAGE =
  'preload 禁止新增同步 IPC（sendSync / invokeSync 会卡住整个渲染进程）：改用 ipcRenderer.invoke + ipcMain.handle（存量冻结在 scripts/t8-structural-guards-baseline.json，只减不增）。'
export const rendererSyncIpcSelectors = [
  {
    selector: 'CallExpression[callee.name="invokeSync"]',
    message: RENDERER_SYNC_IPC_MESSAGE,
  },
  {
    selector: 'CallExpression > MemberExpression.callee[property.name="sendSync"]',
    message: RENDERER_SYNC_IPC_MESSAGE,
  },
]

// ── 9. 迁自 check:builtin-vendor-literals：内置供应商身份只经 builtinVendorIdentity ──────────────────
const BUILTIN_VENDOR_KEYS = '/^(?:apimart|kie|newapi|volcengine|volcengine-speech|agnes|modelscope|minimax|elevenlabs|meshy|higgsfield|fal|runway|replicate|runninghub)$/'
const VENDOR_IDENT_NAME = '/^(?:vendor|vendorKey|providerId|targetVendor|modelVendor)$/'
const VENDOR_PROP_NAME = '/^(?:key|vendorKey|providerId|targetVendor|modelVendor|vendor)$/'
export const BUILTIN_VENDOR_LITERALS_MESSAGE =
  '内置供应商身份不要写成字面量比较或 .has("apimart")（兄弟连接 apimart--mini 会全部认错）：改用 electron/shared/builtinVendorIdentity 的 isVendorOfBuiltin / builtinVendorKeyOfKey。'
export const BUILTIN_HOST_STEP_MESSAGE =
  'deriveVendorKeyFromBaseUrl 只是 connectionVendorKey.ts 的内部 host 步：改调 resolveConnectionVendorKey / resolveHostVendorKey。'
export const builtinVendorLiteralsSelectors = [
  {
    selector: `BinaryExpression[operator=/^(===|!==)$/][left.type="Identifier"][left.name=${VENDOR_IDENT_NAME}][right.type="Literal"][right.value=${BUILTIN_VENDOR_KEYS}]`,
    message: BUILTIN_VENDOR_LITERALS_MESSAGE,
  },
  {
    selector: `BinaryExpression[operator=/^(===|!==)$/][left.type="MemberExpression"][left.property.name=${VENDOR_PROP_NAME}][right.type="Literal"][right.value=${BUILTIN_VENDOR_KEYS}]`,
    message: BUILTIN_VENDOR_LITERALS_MESSAGE,
  },
  {
    selector: `CallExpression[callee.property.name="has"][arguments.length=1] > Literal.arguments[value=${BUILTIN_VENDOR_KEYS}]`,
    message: BUILTIN_VENDOR_LITERALS_MESSAGE,
  },
]
export const builtinHostStepSelectors = [
  {
    selector: 'CallExpression[callee.name="deriveVendorKeyFromBaseUrl"]',
    message: BUILTIN_HOST_STEP_MESSAGE,
  },
]

export function createT8StructuralGuardBlocks({ applyBaselineIgnores = true, baseline = loadT8Baseline() } = {}) {
  const baselineFiles = (ruleId) => (applyBaselineIgnores ? Object.keys(baseline?.rules?.[ruleId] ?? {}) : [])
  return [
    {
      files: ['src/**/*.{ts,tsx,mts,cts}', 'electron/**/*.{ts,tsx,mts,cts}'],
      ignores: [...TEST_IGNORES, ...baselineFiles('generic-fs-watch/no-restricted-syntax')],
      plugins: { 'generic-fs-watch': syntaxPlugin() },
      rules: { 'generic-fs-watch/no-restricted-syntax': ['error', ...genericFsWatchSelectors] },
    },
    {
      files: ['src/**/*.{ts,tsx,mts,cts}', 'electron/**/*.{ts,tsx,mts,cts}'],
      ignores: [...TEST_IGNORES, ...baselineFiles('generic-map-eviction/no-restricted-syntax')],
      plugins: { 'generic-map-eviction': syntaxPlugin() },
      rules: { 'generic-map-eviction/no-restricted-syntax': ['error', ...genericMapEvictionSelectors] },
    },
    {
      files: ['electron/**/*.{ts,tsx,mts,cts}'],
      ignores: [...TEST_IGNORES, 'electron/jsonFile.ts', ...baselineFiles('generic-raw-rename/no-restricted-syntax')],
      plugins: { 'generic-raw-rename': syntaxPlugin() },
      rules: { 'generic-raw-rename/no-restricted-syntax': ['error', ...genericRawRenameSelectors] },
    },
    {
      files: ['src/**/*.{ts,tsx,mts,cts}', 'electron/**/*.{ts,tsx,mts,cts}'],
      ignores: [
        ...TEST_IGNORES,
        'electron/sharingRetry.ts',
        'electron/vendor/vendorHttp.ts',
        'src/workbench/generationCanvas/runner/generationRetryPolicy.ts',
        ...baselineFiles('generic-retry-loop/no-restricted-syntax'),
      ],
      plugins: { 'generic-retry-loop': syntaxPlugin() },
      rules: { 'generic-retry-loop/no-restricted-syntax': ['error', ...genericRetryLoopSelectors] },
    },
    {
      files: ['src/**/*.{ts,tsx,mts,cts}', 'electron/**/*.{ts,tsx,mts,cts}'],
      ignores: [
        ...TEST_IGNORES,
        'src/i18n/**',
        'src/devlab/**',
        'electron/shared/vendorFailure.ts',
        'electron/shared/generationFailureDetect.ts',
        'electron/shared/generationFailure.ts',
        ...baselineFiles('vendor-failure-one-home/no-restricted-syntax'),
      ],
      plugins: { 'vendor-failure-one-home': syntaxPlugin() },
      rules: { 'vendor-failure-one-home/no-restricted-syntax': ['error', ...vendorFailureOneHomeSelectors] },
    },
    {
      files: ['electron/**/*.{ts,tsx,mts,cts}'],
      ignores: TEST_IGNORES,
      plugins: { 'dual-invalidation': syntaxPlugin() },
      rules: { 'dual-invalidation/no-restricted-syntax': ['error', ...dualInvalidationSelectors] },
    },
    {
      files: ['electron/**/*.ts'],
      ignores: TEST_IGNORES,
      plugins: { 'main-console': syntaxPlugin() },
      rules: { 'main-console/no-restricted-syntax': ['error', ...mainConsoleSelectors] },
    },
    {
      files: ['electron/preload.ts', 'electron/preload/**/*.{ts,tsx,mts,cts}'],
      ignores: [...TEST_IGNORES, 'electron/preload/ipcCall.ts', ...baselineFiles('renderer-sync-ipc/no-restricted-syntax')],
      plugins: { 'renderer-sync-ipc': syntaxPlugin() },
      rules: { 'renderer-sync-ipc/no-restricted-syntax': ['error', ...rendererSyncIpcSelectors] },
    },
    {
      files: ['electron/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
      ignores: [...TEST_IGNORES, 'src/devlab/designLab/catalogLiveness/states/01-listing.tsx'],
      plugins: { 'builtin-vendor-literals': syntaxPlugin() },
      rules: { 'builtin-vendor-literals/no-restricted-syntax': ['error', ...builtinVendorLiteralsSelectors] },
    },
    {
      files: ['electron/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
      ignores: [...TEST_IGNORES, 'electron/catalog/connectionVendorKey.ts', 'electron/catalog/catalogCommit.ts'],
      plugins: { 'builtin-host-step': syntaxPlugin() },
      rules: { 'builtin-host-step/no-restricted-syntax': ['error', ...builtinHostStepSelectors] },
    },
  ]
}

export const t8StructuralGuardBlocks = createT8StructuralGuardBlocks({ applyBaselineIgnores: true })
export const t8UnignoredGuardBlocks = createT8StructuralGuardBlocks({ applyBaselineIgnores: false })

/** 纯函数：基线文件只减不增——任一 file × rule 的冻结数比 base 高就拦截。 */
export function judgeT8BaselineGrowth(baseBaseline, headBaseline) {
  const baseRules = baseBaseline?.rules ?? {}
  const headRules = headBaseline?.rules ?? {}
  const grown = []
  for (const [ruleId, filesMap] of Object.entries(headRules)) {
    const baseFiles = baseRules[ruleId] ?? {}
    for (const [file, headCount] of Object.entries(filesMap ?? {})) {
      const baseCount = baseFiles[file] ?? 0
      if (headCount > baseCount) grown.push(`    ${file} ${ruleId}：${baseCount} → ${headCount}`)
    }
  }
  if (grown.length === 0) return []
  return [`✖ ${T8_BASELINE_PATH}：存量基线只减不增，这些条数涨了：\n${grown.join('\n')}`]
}

/** 实跑无 ignores 的 T-8 ESLint 规则，对基线里的 file × rule 做精确计数对账（防同文件增第 2 处，也防修完不收紧）。 */
export async function verifyT8BaselineRatchet({ root = REPO_ROOT, files = null, baseline = loadT8Baseline(root) } = {}) {
  const rulesMap = baseline?.rules ?? {}
  const filterSet = files ? new Set(files) : null
  const targetFiles = new Set()
  for (const filesMap of Object.values(rulesMap)) {
    for (const file of Object.keys(filesMap ?? {})) {
      if (!filterSet || filterSet.has(file)) targetFiles.add(file)
    }
  }
  if (targetFiles.size === 0) return []
  const [{ ESLint }, tseslint] = await Promise.all([import('eslint'), import('typescript-eslint')])
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx,mts,cts}'],
        languageOptions: { parser: tseslint.default.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      },
      ...createT8StructuralGuardBlocks({ applyBaselineIgnores: false, baseline }),
    ],
  })
  const results = await eslint.lintFiles([...targetFiles])
  const actualByRuleFile = new Map()
  for (const res of results) {
    const rel = path.relative(root, res.filePath).split(path.sep).join('/')
    for (const msg of res.messages) {
      if (!msg.ruleId) continue
      const key = `${msg.ruleId}|${rel}`
      actualByRuleFile.set(key, (actualByRuleFile.get(key) ?? 0) + 1)
    }
  }
  const problems = []
  for (const [ruleId, filesMap] of Object.entries(rulesMap)) {
    for (const [file, expected] of Object.entries(filesMap ?? {})) {
      if (filterSet && !filterSet.has(file)) continue
      const actual = actualByRuleFile.get(`${ruleId}|${file}`) ?? 0
      if (actual > expected) {
        problems.push(`✖ ${file} ${ruleId}：冻结 ${expected} 处，实际涨到 ${actual} 处（同文件不许再增违规）`)
      } else if (actual < expected) {
        problems.push(`✖ ${file} ${ruleId}：冻结 ${expected} 处，实际已降到 ${actual} 处（请收紧 ${T8_BASELINE_PATH}）`)
      }
    }
  }
  return problems
}
