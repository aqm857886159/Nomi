// T-8 结构防错 ESLint 规则组（Categories 2 & 3 + 原独立门岗收口迁入）。
//
// 统一收进 ESLint + 原生 eslint-suppressions.json（按文件 × 规则精确计数，只减不增）：
//   · 独立规则 id（syntaxPlugin()）不被后面 flat-config 块覆盖；
//   · 存量债统一冻结在 ESLint 原生 eslint-suppressions.json（同文件多加 1 处即整条规则报红，修完未收紧报 unused suppressions）；
//   · 同时把原 check:main-console / check:renderer-sync-ipc / check:builtin-vendor-literals
//     及 SM-gates-B2 的 check:model-identity / check:script-network-retry / check:batch-machines（third-frozen-judgment）
//     收口进 ESLint 并同提交删旧，使本地与 CI 门岗总数真正净减。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinRules } from 'eslint/use-at-your-own-risk'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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
  '不要在业务文件里再手写一份 Map.keys().next() FIFO/LRU 淘汰缓存：渲染层优先用已装的 swr，主进程收口到唯一有界缓存主人（存量冻结在 eslint-suppressions.json，只减不增）。'
export const genericMapEvictionSelectors = [
  {
    selector: 'CallExpression > MemberExpression.callee[property.name="next"] > CallExpression.object > MemberExpression.callee[property.name="keys"]',
    message: GENERIC_MAP_EVICTION_MESSAGE,
  },
]

// ── 3. 第 2 类：原生 rename 收口到 electron/jsonFile.ts ─────────────────────
export const GENERIC_RAW_RENAME_MESSAGE =
  '主进程文件原子改名经 electron/jsonFile.ts：用 renameWithRetry / renameSyncWithRetry / writeJsonFileAtomic；由调用方负责重验或退避时，用 renameSyncOnce。'
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

// ── 4. 第 2 类：禁止在 for/while 中手写指数退避重试循环 ─────────────────────────────────────────────
export const GENERIC_RETRY_LOOP_MESSAGE =
  '禁止手写指数退避重试循环，请改用已批准接入的现成库 p-retry（见 T-8 替换表）。'
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
    selector: 'Literal[value=/^(?:insufficient_quota|insufficient_user_quota|pre_consume_token_quota_failed|余额不足|额度不足)$/]',
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

// ── 7. 迁自 check:main-console：主进程硬零禁止 console.* 调用（覆盖 electron/**/*.{ts,tsx,mts,cts}）──
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
  'preload 禁止新增同步 IPC（sendSync / invokeSync 会卡住整个渲染进程）：改用 ipcRenderer.invoke + ipcMain.handle（存量冻结在 eslint-suppressions.json，只减不增）。'
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

// ── 10. SM-gates-B2-4（迁自 check:model-identity）：多供应商并存层含 modelKey/modelAlias 必成对携带 vendor ──
const MODEL_IDENTITY_FIELDS = new Set(['modelKey', 'modelAlias'])
const VENDOR_IDENTITY_FIELDS = new Set([
  'vendor', 'vendorKey', 'modelVendor', 'vendorName',
  'providerKey', 'provider', 'providers',
])
/**
 * 历史单一供应商上下文或碰撞消歧受控存量（原 scripts/model-identity-baseline.json 5 处，只减不增）：
 * 按「文件路径 → 允许的精确成员签名数组」逐处核对，避免整文件豁免导致同文件新增裸 modelKey 漏网。
 */
export const MODEL_IDENTITY_FROZEN_ALLOWLIST = Object.freeze({
  'src/workbench/ai/assistantModelIdentity.ts': Object.freeze(['modelKey']), // labelForModel 碰撞消歧探测器：故意只按 modelKey 数重名供应商
  'src/workbench/api/taskApi.ts': Object.freeze(['modelKey,revisionId,taskKind', 'modelKey,revisionId,taskKind']), // ComfyUI 候选认证：vendor 在首参或由全局唯一 revisionId 定界
  'src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts': Object.freeze(['archetype,modelKey']), // normalizeArchetypeVariantMeta：已在确定 ModelArchetype 内折叠旧变体串
  'src/workbench/observability/classifyError.ts': Object.freeze(['modelKey,registered,requested']), // modelKindFix 诊断载荷投影
})
export const MODEL_IDENTITY_MESSAGE =
  '模型身份唯一键是 (vendor, modelKey)：在多供应商并存层（src/workbench、src/config）声明 modelKey / modelAlias 的接口、类型字面量或函数参数，必须同时声明供应商字段（vendor / vendorKey / modelVendor / providerKey / provider）。'

function staticKeyName(key, computed = false) {
  if (!key) return null
  if (key.type === 'Identifier' && !computed) return key.name
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value
  if (key.type === 'TemplateLiteral' && key.expressions.length === 0) return key.quasis[0]?.value?.cooked ?? null
  return null
}

function extractFunctionParamNames(params) {
  const names = []
  for (const param of params) {
    const target = param.type === 'AssignmentPattern' ? param.left : param
    if (target.type === 'Identifier') {
      names.push(target.name)
    } else if (target.type === 'ObjectPattern' && !param.typeAnnotation && !(param.type === 'AssignmentPattern' && param.left.typeAnnotation)) {
      // 无类型注解的对象解构形参（有类型注解的由 TSTypeLiteral 分支拦截，避免双报）
      for (const prop of target.properties) {
        if (prop.type === 'Property') {
          const name = staticKeyName(prop.key, prop.computed)
          if (name) names.push(name)
        }
      }
    }
  }
  return names
}

export const modelIdentityVendorRule = {
  meta: { type: 'problem', schema: [], messages: { bareModelKey: '{{message}}（签名：{{label}}）' } },
  create(context) {
    const relative = path.relative(REPO_ROOT, context.filename).split(path.sep).join('/')
    const findings = []
    const checkFunction = (node) => {
      const names = extractFunctionParamNames(node.params ?? [])
      const hasModel = names.some((name) => MODEL_IDENTITY_FIELDS.has(name))
      const hasVendor = names.some((name) => VENDOR_IDENTITY_FIELDS.has(name))
      if (hasModel && !hasVendor) {
        findings.push({ node, label: `fn(${names.join(',')})` })
      }
    }
    const checkTypeMembers = (node, members, interfaceName = null) => {
      const names = []
      for (const member of members) {
        if (member.type !== 'TSPropertySignature' && member.type !== 'TSMethodSignature') continue
        const name = staticKeyName(member.key, member.computed)
        if (name) names.push(name)
      }
      const hasModel = names.some((name) => MODEL_IDENTITY_FIELDS.has(name))
      const hasVendor = names.some((name) => VENDOR_IDENTITY_FIELDS.has(name))
      if (hasModel && !hasVendor) {
        const label = interfaceName ?? [...names].slice(0, 4).sort().join(',')
        findings.push({ node, label })
      }
    }
    return {
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
      TSInterfaceDeclaration(node) {
        checkTypeMembers(node, node.body?.body ?? [], node.id?.name ?? null)
      },
      TSTypeLiteral(node) {
        checkTypeMembers(node, node.members ?? [], null)
      },
      'Program:exit'() {
        const remainingAllowed = [...(MODEL_IDENTITY_FROZEN_ALLOWLIST[relative] ?? [])]
        for (const finding of findings) {
          const idx = remainingAllowed.indexOf(finding.label)
          if (idx >= 0) {
            remainingAllowed.splice(idx, 1)
            continue
          }
          context.report({
            node: finding.node,
            messageId: 'bareModelKey',
            data: { message: MODEL_IDENTITY_MESSAGE, label: finding.label },
          })
        }
      },
    }
  },
}

// ── 11. SM-gates-B2-8（迁自 check:script-network-retry）：scripts/ 网络调用必走共用瞬断重试边界 ────────
export const SCRIPT_NETWORK_RETRY_OWNER_FILES = Object.freeze(['scripts/lib/transientRetry.mjs'])
const CONTROL_PLANE_HOST = /(?:api\.github\.com|uploads\.github\.com|api\.cloudflare\.com|registry\.npmjs\.org)/u
const RETRY_WRAPPERS = new Set(['retryTransient', 'retryTransientSync'])
const GIT_NETWORK_SUBCOMMANDS = new Set(['fetch', 'ls-remote', 'pull', 'clone'])
export const SCRIPT_NETWORK_RETRY_FIX_HINT =
  '读：execGhReadSync / fetchWithRetry / retryTransient 包住；写：execGhWriteSync（只试一次）。见 scripts/lib/transientRetry.mjs'

function unwrapTsExpression(node) {
  let current = node
  while (
    current
    && (current.type === 'TSAsExpression'
      || current.type === 'TSSatisfiesExpression'
      || current.type === 'TSTypeAssertion'
      || current.type === 'TSNonNullExpression'
      || current.type === 'ChainExpression')
  ) {
    current = current.expression
  }
  return current
}

function staticStringPrefix(rawNode) {
  const node = unwrapTsExpression(rawNode)
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral') return node.quasis[0]?.value?.cooked ?? node.quasis[0]?.value?.raw ?? null
  return null
}

function insideTransientRetryWrapper(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'CallExpression') {
      const callee = unwrapTsExpression(parent.callee)
      const name = callee?.type === 'Identifier'
        ? callee.name
        : callee?.type === 'MemberExpression'
          ? staticKeyName(callee.property, callee.computed)
          : ''
      if (name && RETRY_WRAPPERS.has(name)) return true
    }
  }
  return false
}

export const scriptNetworkRetryRule = {
  meta: { type: 'problem', schema: [], messages: { unretried: '[{{rule}}] {{message}}' } },
  create(context) {
    let controlPlane = false
    const calls = []
    const fetchIdentifiers = []
    const globalFetches = []
    return {
      Literal(node) {
        if (typeof node.value === 'string' && CONTROL_PLANE_HOST.test(node.value)) controlPlane = true
      },
      TemplateElement(node) {
        const text = node.value?.cooked ?? node.value?.raw ?? ''
        if (CONTROL_PLANE_HOST.test(text)) controlPlane = true
      },
      CallExpression(node) {
        calls.push(node)
      },
      Identifier(node) {
        if (node.name === 'fetch') fetchIdentifiers.push(node)
      },
      MemberExpression(node) {
        const obj = unwrapTsExpression(node.object)
        const prop = staticKeyName(node.property, node.computed)
        if (obj?.type === 'Identifier' && obj.name === 'globalThis' && prop === 'fetch') {
          globalFetches.push(node)
        }
      },
      'Program:exit'() {
        for (const node of calls) {
          const first = unwrapTsExpression(node.arguments[0])
          const command = staticStringPrefix(first)
            ?? (first && (first.type === 'LogicalExpression' || first.type === 'BinaryExpression') ? staticStringPrefix(first.right) : null)
          if (command !== null && !insideTransientRetryWrapper(node)) {
            const second = unwrapTsExpression(node.arguments[1])
            const words = command.trim().split(/\s+/u)
            const gitSub = command === 'git' && second?.type === 'ArrayExpression'
              ? staticStringPrefix(second.elements[0])
              : words[0] === 'git'
                ? words[1]
                : null
            if (command === 'gh' || words[0] === 'gh') {
              context.report({ node, messageId: 'unretried', data: { rule: 'gh-raw', message: `gh 调用没有走共用边界：${SCRIPT_NETWORK_RETRY_FIX_HINT}` } })
            } else if (gitSub && GIT_NETWORK_SUBCOMMANDS.has(gitSub)) {
              context.report({ node, messageId: 'unretried', data: { rule: 'git-net', message: `git ${gitSub} 是网络调用，没有走共用重试：${SCRIPT_NETWORK_RETRY_FIX_HINT}` } })
            }
          }
          const callee = unwrapTsExpression(node.callee)
          if (controlPlane && callee?.type === 'Identifier' && (callee.name === 'fetch' || callee.name === 'fetchImpl')) {
            context.report({
              node,
              messageId: 'unretried',
              data: { rule: 'fetch-bare', message: `控制面 API 调用直接用 ${callee.name}(...)：改用 fetchWithRetry(url, init, { fetchImpl })` },
            })
          }
        }
        if (!controlPlane) return
        for (const node of fetchIdentifiers) {
          const parent = node.parent
          const isPropertyKey = (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed)
            || (parent?.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand)
            || (parent?.type === 'MethodDefinition' && parent.key === node && !parent.computed)
            || parent?.type === 'TSTypeReference'
            || parent?.type === 'TSTypeQuery'
          const isDirectCallee = parent?.type === 'CallExpression' && unwrapTsExpression(parent.callee) === node
          const isAssertedCallee = parent?.type?.startsWith('TS') && parent.parent?.type === 'CallExpression' && unwrapTsExpression(parent.parent.callee) === node
          if (!isPropertyKey && !isDirectCallee && !isAssertedCallee) {
            context.report({
              node,
              messageId: 'unretried',
              data: { rule: 'fetch-bare', message: '控制面 API 文件里出现裸 fetch 引用：改用 fetchWithRetry' },
            })
          }
        }
        for (const node of globalFetches) {
          context.report({
            node,
            messageId: 'unretried',
            data: { rule: 'fetch-bare', message: 'globalThis.fetch 绕过共用重试边界：改用 fetchWithRetry' },
          })
        }
      },
    }
  },
}

// ── 12. SM-gates-B2-9（迁自 check:batch-machines third-frozen-judgment）：禁第三份 frozen.at > 0 判据 ──
export const FROZEN_JUDGMENT_HOMES = Object.freeze([
  'electron/capabilityCore/anchorBible.ts',
  'src/workbench/generationCanvas/model/anchorBibleKeys.ts',
])
export const THIRD_FROZEN_JUDGMENT_MESSAGE =
  '冻结判据（frozen.at > 0 数值门）只准两处：electron/capabilityCore/anchorBible.ts（权威 isAnchorFrozen）与 src/workbench/generationCanvas/model/anchorBibleKeys.ts（渲染层镜像）。请直接 import 这两处之一，禁止手写第三份。'

function isAtTarget(rawNode) {
  const node = unwrapTsExpression(rawNode)
  if (!node) return false
  if (node.type === 'Identifier' && node.name === 'at') return true
  if (node.type === 'MemberExpression' && staticKeyName(node.property, node.computed) === 'at') return true
  return false
}

function isZeroLiteral(rawNode) {
  const node = unwrapTsExpression(rawNode)
  return node?.type === 'Literal' && node.value === 0
}

export const thirdFrozenJudgmentRule = {
  meta: { type: 'problem', schema: [], messages: { thirdHome: THIRD_FROZEN_JUDGMENT_MESSAGE } },
  create(context) {
    return {
      BinaryExpression(node) {
        const isAtGreaterZero =
          (node.operator === '>' && isAtTarget(node.left) && isZeroLiteral(node.right))
          || (node.operator === '<' && isZeroLiteral(node.left) && isAtTarget(node.right))
        if (!isAtGreaterZero || !node.loc) return
        const line = node.loc.start.line
        const tokens = context.sourceCode.ast.tokens?.filter(
          (tok) => tok.loc.start.line >= line - 3 && tok.loc.end.line <= line + 3,
        ) ?? []
        const windowText = tokens.map((tok) => tok.value).join(' ')
        const hasFrozen = tokens.some((tok) => /frozen/i.test(tok.value))
        const hasNumericGate =
          (tokens.some((tok) => tok.value === 'typeof') && tokens.some((tok) => /^['"`]?number['"`]?$/.test(tok.value)))
          || /Number\s*\.\s*isFinite/.test(windowText)
        if (hasFrozen && hasNumericGate) {
          context.report({ node, messageId: 'thirdHome' })
        }
      },
    }
  },
}

export const t8StructuralGuardBlocks = [
  {
    files: ['src/**/*.{ts,tsx,mts,cts}', 'electron/**/*.{ts,tsx,mts,cts}'],
    ignores: TEST_IGNORES,
    plugins: { 'generic-fs-watch': syntaxPlugin() },
    rules: { 'generic-fs-watch/no-restricted-syntax': ['error', ...genericFsWatchSelectors] },
  },
  {
    files: ['src/**/*.{ts,tsx,mts,cts}', 'electron/**/*.{ts,tsx,mts,cts}'],
    ignores: TEST_IGNORES,
    plugins: { 'generic-map-eviction': syntaxPlugin() },
    rules: { 'generic-map-eviction/no-restricted-syntax': ['error', ...genericMapEvictionSelectors] },
  },
  {
    files: ['electron/**/*.{ts,tsx,mts,cts}'],
    ignores: [...TEST_IGNORES, 'electron/jsonFile.ts'],
    plugins: { 'generic-raw-rename': syntaxPlugin() },
    rules: { 'generic-raw-rename/no-restricted-syntax': ['error', ...genericRawRenameSelectors] },
  },
  {
    files: ['src/**/*.{ts,tsx,mts,cts}', 'electron/**/*.{ts,tsx,mts,cts}'],
    ignores: [
      ...TEST_IGNORES,
      'electron/sharingRetry.ts',
      'electron/vendor/vendorHttp.ts',
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
    files: ['electron/**/*.{ts,tsx,mts,cts}'],
    ignores: TEST_IGNORES,
    plugins: { 'main-console': syntaxPlugin() },
    rules: { 'main-console/no-restricted-syntax': ['error', ...mainConsoleSelectors] },
  },
  {
    files: ['electron/preload.ts', 'electron/preload/**/*.{ts,tsx,mts,cts}'],
    ignores: [...TEST_IGNORES, 'electron/preload/ipcCall.ts'],
    plugins: { 'renderer-sync-ipc': syntaxPlugin() },
    rules: { 'renderer-sync-ipc/no-restricted-syntax': ['error', ...rendererSyncIpcSelectors] },
  },
  {
    files: ['electron/**/*.{ts,tsx,mts,cts}', 'src/**/*.{ts,tsx,mts,cts}'],
    ignores: [...TEST_IGNORES, 'src/devlab/designLab/catalogLiveness/states/01-listing.tsx'],
    plugins: { 'builtin-vendor-literals': syntaxPlugin() },
    rules: { 'builtin-vendor-literals/no-restricted-syntax': ['error', ...builtinVendorLiteralsSelectors] },
  },
  {
    files: ['electron/**/*.{ts,tsx,mts,cts}', 'src/**/*.{ts,tsx,mts,cts}'],
    ignores: [...TEST_IGNORES, 'electron/catalog/connectionVendorKey.ts', 'electron/catalog/catalogCommit.ts'],
    plugins: { 'builtin-host-step': syntaxPlugin() },
    rules: { 'builtin-host-step/no-restricted-syntax': ['error', ...builtinHostStepSelectors] },
  },
  {
    files: ['src/workbench/**/*.{ts,tsx}', 'src/config/**/*.{ts,tsx}'],
    ignores: [...TEST_IGNORES, '**/*.d.ts'],
    plugins: { 'model-identity-vendor': { rules: { 'require-vendor': modelIdentityVendorRule } } },
    rules: { 'model-identity-vendor/require-vendor': 'error' },
  },
  {
    files: ['scripts/**/*.{mjs,cjs,js,ts,mts,cts}'],
    ignores: [...TEST_IGNORES, '**/*.node-test.{mjs,cjs,js,ts,mts,cts}', ...SCRIPT_NETWORK_RETRY_OWNER_FILES],
    plugins: { 'script-network-retry': { rules: { 'require-transient-retry': scriptNetworkRetryRule } } },
    rules: { 'script-network-retry/require-transient-retry': 'error' },
  },
  {
    files: ['src/**/*.{ts,tsx,mts,cts}', 'electron/**/*.{ts,tsx,mts,cts}'],
    ignores: [...TEST_IGNORES, ...FROZEN_JUDGMENT_HOMES],
    plugins: { 'batch-frozen-judgment': { rules: { 'single-frozen-judgment': thirdFrozenJudgmentRule } } },
    rules: { 'batch-frozen-judgment/single-frozen-judgment': 'error' },
  },
]
