// ESLint flat config —— 宽松起步策略：
//   真能抓 bug 的规则设 error（红牌，阻断 CI）；风格 / any / 未用变量等存量问题
//   设 warn（黄牌，只提示不阻断）。目标是「挡住新增的脏东西」，存量债逐步还，
//   而不是一上来一片红把人吓退。详见 docs/audit/2026-06-04-full-codebase-review-6role.md。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import prettier from 'eslint-config-prettier'
import fs from 'node:fs'
import { builtinRules } from 'eslint/use-at-your-own-risk'
import {
  CANVAS_SHELL_FILE,
  SHELL_SELECTION_SELECTORS,
  WHOLE_TABLE_SUBSCRIPTION_BASELINE,
  WHOLE_TABLE_SUBSCRIPTION_SELECTORS,
} from './scripts/canvas-store-subscriptions.mjs'
import {
  FORMAT_MONEY_IMPORTERS,
  FORMAT_MONEY_IMPORT_PATTERN,
  FORMAT_MONEY_MODULE,
  MONEY_FORMAT_EXITS,
  MONEY_FORMAT_SELECTORS,
  UI_MONEY_FILES,
  UI_MONEY_TEST_FILES,
} from './scripts/ui-money-format.mjs'

// 用例 / 钩子不许单独设比 vitest 全局更短的超时（全局值见 vitest.config.ts 的 testTimeout / hookTimeout，都是 30_000；
// 两处同值由 scripts/vitest-timeout-floor.test.mjs 核对）。超时被放弃的用例仍在后台跑完，把任务或半初始化模块留给下一个用例
// ——2026-10-10 exportJobIpc：第一个用例 15 秒超时，后面 9 个全被「已有导出在进行」拖红。见 docs/lessons/timed-out-tests-keep-running-and-poison-the-next-one.md。
export const VITEST_TIMEOUT_FLOOR_MS = 30_000
const SHORTENED_TIMEOUT_MESSAGE = 'Do not pass a timeout shorter than the vitest global (vitest.config.ts testTimeout / hookTimeout); a timed-out test keeps running in the background and leaks into the next test. Drop the argument.'
const TEST_CALL = "CallExpression:matches([callee.name=/^(it|test)$/], [callee.object.name=/^(it|test)$/], [callee.callee.object.name=/^(it|test)$/], [callee.callee.name=/^(it|test)$/])"
const HOOK_CALL = "CallExpression[callee.name=/^(before|after)(Each|All)$/]"
const shortenedTimeoutSelectors = [TEST_CALL, HOOK_CALL].flatMap((call) => [
  { selector: `${call}[arguments.length>=2] > Literal.arguments:last-child[value<${VITEST_TIMEOUT_FLOOR_MS}]`, message: SHORTENED_TIMEOUT_MESSAGE },
  { selector: `${call}[arguments.length>=2] > ObjectExpression.arguments:last-child > Property[key.name='timeout'] > Literal.value[value<${VITEST_TIMEOUT_FLOOR_MS}]`, message: SHORTENED_TIMEOUT_MESSAGE },
])

/**
 * Store 选择器里禁止 JSON.stringify（2026-10-16 卡顿波）：选择器每次 store 写都会跑，序列化防抖等于
 * 「每一次别的卡的生成进度都把整份派生值重算 + 序列化一遍」。要稳定引用，用依赖面签名
 * （src/workbench/generationCanvas/nodes/composerGraphSnapshot.ts）或在组件里 useContentStable 逐字段比。
 */
const storeSelectorSerializeSelectors = [
  {
    selector: "CallExpression[callee.name=/^use[A-Z][A-Za-z0-9]*Store$/] > :function CallExpression[callee.object.name='JSON'][callee.property.name='stringify']",
    message: '不要在 store 选择器里 JSON.stringify：它在每次 store 写都会跑。用 composerGraphSnapshot 的依赖面快照，或在组件里 useContentStable 逐字段比。',
  },
]

// 用例体 / 钩子里不许 `await import(...)`：冷转换一大片生产模块的那几秒记在用例或钩子的 30 秒超时里，
// 机器一忙（并行推送前钩子 / CI 满载）就超时——单跑都能过、满载必红。静态 import 在收集阶段加载，不占用例超时，
// vi.mock 会被提升、静态 import 照样吃到。2026-10-15：tryModelSubmitBudget「Hook timed out in 30000ms」、readTaskTarget 单跑 35 秒、
// runtime.fallback-path 等。确需在用例里重新加载（重启模拟 / 每例换模块状态）的，在该行上方写
// `// eslint-disable-next-line no-restricted-syntax -- <理由>`；存量见下面的基线文件，只许减不许增（scripts/vitest-timeout-floor.test.mjs 核对）。
export const COLD_IMPORT_BASELINE_PATH = 'docs/engineering/test-cold-import-baseline.json'
const COLD_IMPORT_MESSAGE = 'Do not await import() inside a test or hook body: the cold transform counts against the 30s test/hook timeout and times out under load. Use a static import (vi.mock is hoisted), or for a restart simulation add // eslint-disable-next-line no-restricted-syntax -- <reason>.'
export const coldImportSelectors = [TEST_CALL, HOOK_CALL].map((call) => ({ selector: `${call} ImportExpression`, message: COLD_IMPORT_MESSAGE }))
const coldImportBaselineFiles = Object.keys(JSON.parse(fs.readFileSync(new URL(COLD_IMPORT_BASELINE_PATH, import.meta.url), 'utf8')).files)

const testFileRestrictedSyntax = [
  ...shortenedTimeoutSelectors,
  {
    selector: "AssignmentExpression[left.type='MemberExpression'][left.object.type='MemberExpression'][left.object.object.name='process'][left.object.property.name='env']",
    message: 'Use vi.stubEnv(name, value) so Vitest restores process.env after each test.',
  },
  {
    selector: "UnaryExpression[operator='delete'][argument.type='MemberExpression'][argument.object.type='MemberExpression'][argument.object.object.name='process'][argument.object.property.name='env']",
    message: 'Use vi.stubEnv(name, undefined) so Vitest restores process.env after each test.',
  },
  {
    selector: "CallExpression[callee.name='beforeAll'] CallExpression[callee.object.name='vi'][callee.property.name='stubEnv']",
    message: 'unstubEnvs: true restores env after each test; put vi.stubEnv in beforeEach.',
  },
  {
    selector: "CallExpression[callee.object.name='vi'][callee.property.name='hoisted'] CallExpression[callee.object.name='vi'][callee.property.name='stubEnv']",
    message: 'unstubEnvs: true restores env after each test; put vi.stubEnv in beforeEach.',
  },
  {
    selector: "Program > ExpressionStatement > CallExpression[callee.object.name='vi'][callee.property.name='stubEnv']",
    message: 'unstubEnvs: true restores env after each test; put vi.stubEnv in beforeEach.',
  },
]

// Main-process synchronous waits freeze IPC while waiting. Existing debt uses
// ESLint bulk suppressions (file x rule counts); new calls fail and deleted calls
// require --prune-suppressions. The independent core-rule id survives overrides.
const mainSyncWaitPlugin = { rules: { 'no-restricted-syntax': builtinRules.get('no-restricted-syntax') } }
const mainSyncWaitSelectors = [{
  selector: "MemberExpression[object.name='Atomics'][computed=false][property.name='wait'], MemberExpression[object.name='Atomics'][computed=true][property.value='wait'], VariableDeclarator[init.name='Atomics'] > ObjectPattern > Property[key.name='wait'], VariableDeclarator[init.name='Atomics'] > ObjectPattern > Property[key.value='wait']",
  message: 'Do not add Atomics.wait in the main process: synchronous sleep blocks IPC and window events. Use an asynchronous retry; existing debt may only decrease.',
}]

const windowsPathSelectors = [
  {
    selector: 'MemberExpression[property.name="pathname"][object.type="NewExpression"][object.callee.name="URL"]:has(MetaProperty)',
    message: 'Use node:url fileURLToPath for filesystem paths; URL.pathname is not a Windows filesystem path.',
  },
]

// Event names, not call shapes: an aliased `const on = app.on`, `app["on"]`, `emitter.prependOnceListener`
// or a template literal all still have to spell the event, so the name is the one thing a bypass
// cannot avoid (R-review-1125 #3). Only the owner may spell these.
const quitEventSelectors = (name, message) => [
  { selector: `Literal[value="${name}"]`, message },
  { selector: `TemplateElement[value.cooked="${name}"]`, message },
]
const quitLifecycleSelectors = [
  ...quitEventSelectors('will-quit', 'Subscribe to will-quit only in electron/quitTeardown.ts; register a drain with quitTeardown instead.'),
  ...quitEventSelectors('before-quit', 'Subscribe to before-quit only in electron/quitTeardown.ts; use quitTeardown state instead.'),
  // Windows session end and Linux powerMonitor shutdown bypass before-quit / will-quit.
  ...['query-session-end', 'session-end'].flatMap((name) => quitEventSelectors(name, 'Subscribe to system session end only in electron/quitTeardown.ts; it runs the critical drains before exit.')),
  {
    // "shutdown" is an ordinary word elsewhere; ban it as an event argument of any call.
    selector: 'CallExpression > Literal.arguments[value="shutdown"], CallExpression > TemplateLiteral.arguments > TemplateElement[value.cooked="shutdown"]',
    message: 'Subscribe to system session end only in electron/quitTeardown.ts; it runs the critical drains before exit.',
  },
]

// Any access to app.exit / app.relaunch (call, alias, bind, optional chain, computed key,
// destructuring) and aliasing `app` itself, so the access cannot hide behind another name.
// Scoped to files that take `app` from electron: plain Node files may have their own `app` object.
const appExitMember = '/^(exit|relaunch)$/'
const directQuitMessage = 'Call app.exit / app.relaunch only from electron/quitTeardown.ts or a documented independent-process exemption.'
const appAliasMessage = 'Do not alias Electron app; aliases hide app.exit from the quit-owner guard.'
const electronAppFiles = [
  'Program:has(ImportDeclaration[source.value="electron"] > ImportSpecifier[imported.name="app"])',
  'Program:has(VariableDeclarator[init.callee.name="require"][init.arguments.0.value="electron"] > ObjectPattern > Property[key.name="app"])',
]
const inElectronAppFiles = (selector, message) => electronAppFiles.map((scope) => ({ selector: `${scope} ${selector}`, message }))
const directQuitSelectors = [
  ...inElectronAppFiles(`MemberExpression[object.name="app"][property.name=${appExitMember}]`, directQuitMessage),
  ...inElectronAppFiles(`MemberExpression[object.name="app"][computed=true][property.value=${appExitMember}]`, directQuitMessage),
  ...inElectronAppFiles(`VariableDeclarator[init.name="app"] > ObjectPattern > Property[key.name=${appExitMember}]`, directQuitMessage),
  ...inElectronAppFiles('VariableDeclarator[init.name="app"][id.type="Identifier"]', appAliasMessage),
  ...inElectronAppFiles('AssignmentExpression[right.name="app"]', appAliasMessage),
  { selector: 'ImportDeclaration[source.value="electron"] > ImportSpecifier[imported.name="app"][local.name!="app"]', message: appAliasMessage },
  // `electron.app.exit(...)` / `require("electron").app.exit(...)`.
  { selector: `MemberExpression[object.property.name="app"][property.name=${appExitMember}]`, message: directQuitMessage },
  {
    selector: 'CallExpression[callee.type="MemberExpression"][callee.object.name="autoUpdater"][callee.property.name="quitAndInstall"]',
    message: 'Call autoUpdater.quitAndInstall only from electron/quitTeardown.ts or a documented updater exemption.',
  },
]

// Playwright 的 isVisible / isHidden 不等待：传进去的 timeout 被忽略、立刻返回（playwright-core types.d.ts 把
// Locator / Page / Frame 上这两个方法的 timeout 都标了 @deprecated）。2026-10-22 三条付费样本按「最多等 N 秒」写，
// 实际一次没等，后面的流程空等 20 分钟。eslint-plugin-playwright 的 no-action-timeout 不管这两个方法、
// typescript-eslint no-deprecated 不报对象字面量里的弃用键，所以用核心选择器（不要类型信息，.mjs 也行）。
// 调研：docs/audit/2026-10-22-gate-family-direction.md。
//
// 两层（V-gates-g1 窄核后补齐）：
//   ① 全仓：调用时带 timeout 就红——点号调用、计算属性调用（page['isVisible'](…, { timeout })）都算；
//   ② scripts / tests / evals：把这两个方法当值取出来（const fn = page.isHidden、const { isVisible } = page、page['isHidden'] 不调用）
//      一律红，不看 timeout——取出来再调就绕过了 ①，而这种写法在走查里本身就可疑。只放在这三片：src 里 isHidden / isVisible
//      是普通的领域字段（例：分类的 isHidden），全仓开会误报。
// 有意接受的缺口：options 先放进变量再传（const o = { timeout }; loc.isVisible(o)）——静态看不出变量里有没有 timeout，不拦。
const PLAYWRIGHT_NO_WAIT = '/^is(Visible|Hidden)$/'
const PLAYWRIGHT_NO_WAIT_MESSAGE = "isVisible / isHidden do not wait: the timeout is ignored and they return immediately (Playwright marks it @deprecated). To wait, use locator.waitFor({ state: 'visible' | 'hidden', timeout }), e.g. await loc.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false)."
export const playwrightNoWaitSelectors = [
  { selector: `CallExpression[callee.property.name=${PLAYWRIGHT_NO_WAIT}] > ObjectExpression > Property[key.name='timeout']`, message: PLAYWRIGHT_NO_WAIT_MESSAGE },
  { selector: `CallExpression[callee.computed=true][callee.property.value=${PLAYWRIGHT_NO_WAIT}] > ObjectExpression > Property[key.name='timeout']`, message: PLAYWRIGHT_NO_WAIT_MESSAGE },
]
const PLAYWRIGHT_ALIAS_MESSAGE = "Call isVisible / isHidden directly on the locator or page; do not take them as values (alias, destructuring, computed access) - that hides whether a timeout is passed, and they never wait anyway. To wait, use locator.waitFor({ state, timeout })."
export const playwrightAliasSelectors = [
  { selector: `MemberExpression[property.name=${PLAYWRIGHT_NO_WAIT}]:not(CallExpression > MemberExpression.callee)`, message: PLAYWRIGHT_ALIAS_MESSAGE },
  { selector: `MemberExpression[computed=true][property.value=${PLAYWRIGHT_NO_WAIT}]:not(CallExpression > MemberExpression.callee)`, message: PLAYWRIGHT_ALIAS_MESSAGE },
  { selector: `ObjectPattern > Property[key.name=${PLAYWRIGHT_NO_WAIT}]`, message: PLAYWRIGHT_ALIAS_MESSAGE },
  { selector: `ObjectPattern > Property[key.value=${PLAYWRIGHT_NO_WAIT}]`, message: PLAYWRIGHT_ALIAS_MESSAGE },
]
// ② 用核心 no-restricted-syntax 的一份**独立注册**（同一个内置规则，换个规则 id）：flat config 里同名规则后面的块会整条覆盖前面的，
// 只在三片目录开的选择器若混进 no-restricted-syntax，就得在每个能匹配到这三片的块里重拼一遍；独立 id 只有下面一个块配置它，不会被覆盖。
const playwrightAliasPlugin = { rules: { 'no-restricted-syntax': builtinRules.get('no-restricted-syntax') } }
export const PLAYWRIGHT_ALIAS_FILES = ['scripts', 'tests', 'evals'].map((dir) => `${dir}/**/*.{js,mjs,cjs,ts,tsx,mts,cts}`)

// ③ vitest 车道的浏览器夹具测试起 vite 开发服务只经 tests/ux/_browserFixture.mjs 的 useBrowserFixture（2026-10-24）。
// 直接 createServer 会让依赖扫描爬仓库里全部 *.html（596 个），并把夹具页一千多个模块的冷编译算进用例里一次 goto 的操作预算，
// 机器一忙就红、各测试只好把 goto 调到 90 / 120 秒（docs/lessons/fixture-first-goto-is-a-cold-build.md）。
// 同 ② 的做法独立注册内置规则：别的块里同名规则的选项会整条覆盖，这一组只在下面一个块里配置。
const browserFixturePlugin = { rules: {
  'no-restricted-imports': builtinRules.get('no-restricted-imports'),
  'no-restricted-syntax': builtinRules.get('no-restricted-syntax'),
} }
const RAW_VITE_SERVER_MESSAGE = '浏览器夹具测试不直接起 vite 开发服务：用 tests/ux/_browserFixture.mjs 的 useBrowserFixture({ entries })——依赖扫描只认入口页，准备阶段先把页面编完，用例里的 goto 只执行页面。'
export const BROWSER_FIXTURE_TEST_FILES = ['tests/**/*.test.{js,mjs,cjs,ts,tsx,mts,cts}']

// ④ 界面不印金额（2026-10-27）：选择器、出口名单、允许 import 货币格式化函数的名单都住 scripts/ui-money-format.mjs
// （名单只减不增，由 scripts/ui-money-format.test.mjs 按同一组选择器普查全 src 卡死）。同 ② 的做法独立注册内置规则：
// 两张名单的豁免文件不同，各占下面一个块，别的块里同名规则的选项盖不到它们。
const uiMoneyPlugin = { rules: {
  'no-restricted-syntax': builtinRules.get('no-restricted-syntax'),
  'no-restricted-imports': builtinRules.get('no-restricted-imports'),
} }

// ⑤ 渲染层直调主进程的任务口 `nomi:tasks:run` 只有一扇门（2026-10-28）：src/workbench/api/taskApi.ts 的 runWorkbenchTaskByVendor。
// 令牌路普查（scripts/spend-token-doors.mjs）按符号名数门，数不到 `desktop.tasks.run(...)` 这种成员调用：渲染层新文件直接调它，
// 普查、check:run-task-grant、check:generation-entrances 全绿（独立验收 R14）；而这个口缺省走 TOKEN_ADMISSION，没有令牌的付费种类
// 会被主进程的闸拒——浏览器「提取提示词」坏了七周就是这个形状。这条规则让「再加一个直调点」当场红。
// 同 ② 的做法独立注册内置规则：src/** 已经有别的块配了 no-restricted-syntax，同名规则后面的块会整条覆盖前面的。
// 拦得住：点号 / 方括号取 run（desktop.tasks.run、desktop['tasks']['run']、可选链、当值取出来、bind），
//   从桥上解构出 tasks 再 tasks.run，解构 run（const { run } = desktop.tasks、const { tasks: { run } } = desktop）。
// 拦不住（明写的缺口）：换了变量名的别名（const t = desktop.tasks; t.run()）、把 desktop.tasks 当参数传出去——静态看不出那个名字是谁。
const taskRunBridgePlugin = { rules: { 'no-restricted-syntax': builtinRules.get('no-restricted-syntax') } }
const TASK_RUN_BRIDGE_MESSAGE = '渲染层直调 nomi:tasks:run 只有一扇门：src/workbench/api/taskApi.ts 的 runWorkbenchTaskByVendor。'
  + '这个口没有令牌，付费种类会被主进程的闸拒（浏览器「提取提示词」就这样坏了七周）；要花钱就走主进程自己问人、铸令牌再发的那条链，并在 scripts/spend-token-doors.mjs 登记。'
export const TASK_RUN_BRIDGE_DOOR = 'src/workbench/api/taskApi.ts'
export const TASK_RUN_BRIDGE_FILES = ['src/**/*.{ts,tsx}']
export const TASK_RUN_BRIDGE_IGNORES = ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**', TASK_RUN_BRIDGE_DOOR]
/** `tasks` 的几种写法：X.tasks / X['tasks'] / tasks（解构出来的本地名）/ X.tasks! 、(X.tasks as T)、(X?.tasks) 这类外面包了一层的。 */
const TASKS_OWNER = ["property.name='tasks'", "property.value='tasks'", "name='tasks'", "expression.property.name='tasks'", "expression.name='tasks'"]
export const TASK_RUN_BRIDGE_SELECTORS = [
  // X.tasks.run / X.tasks['run'] / tasks.run / tasks['run']：调用、取值、bind 都算。
  ...["[computed=false][property.name='run']", "[computed=true][property.value='run']"]
    .flatMap((run) => TASKS_OWNER.map((owner) => `MemberExpression${run}[object.${owner}]`)),
  // const { run } = X.tasks / tasks、({ run } = X.tasks)、const { tasks: { run } } = X、function f({ tasks: { run } })（键写不写引号都算）。
  ...["VariableDeclarator[init.property.name='tasks']", "VariableDeclarator[init.name='tasks']", "AssignmentExpression[right.property.name='tasks']", "AssignmentExpression[right.name='tasks']", "Property[key.name='tasks']", "Property[key.value='tasks']"]
    .flatMap((from) => ["Property[key.name='run']", "Property[key.value='run']"].map((run) => `${from} > ObjectPattern > ${run}`)),
].map((selector) => ({ selector, message: TASK_RUN_BRIDGE_MESSAGE }))

/**
 * 每个 no-restricted-syntax 都经这里拼：flat config 里后面的对象会**整条覆盖**前面同名规则的选项，
 * 某个块漏写一组选择器，那组在该块的文件上就静默失效。全仓都该成立的选择器（目前是 Playwright 不等待）放在这里，
 * 新加的块只要走这个函数就自动带上（scripts/eslint-script-coverage.test.mjs 按代表路径核）。
 */
const restrictedSyntax = (...selectors) => ['error', ...selectors, ...playwrightNoWaitSelectors]

/** 脚本、走查、评测：2026-10-22 起进 ESLint（之前整片忽略）。存量错误冻结在 eslint-suppressions.json，只减不增。 */
export const SCRIPT_LIKE_FILES = ['scripts/**/*.{mjs,cjs,js}', 'tests/ux/**/*.{mjs,cjs,js}', 'evals/**/*.{mjs,cjs,js}']

// Reviewed exemptions; each call site carries the same reason in a comment.
const directQuitExemptionFiles = [
  // Separate one-shot headless Electron entry (spawned as "electron host.js"); the GUI owner is
  // never installed in that process and its finally block is the whole lifecycle.
  'electron/capabilityCore/host.ts',
  // (the single install entry, see electron/update/installGate.ts)
  // electron-updater quitAndInstall closes windows and then calls app.quit(), so it re-enters the
  // owner's before-quit / will-quit; the restart itself is the updater's platform primitive.
  'electron/update/installGate.ts',
]

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      // 教程站（marketing-docs，Astro）的构建产物与生成类型：check:site 先构建、lint:ci 后扫，顺序依赖会误扫到它们。
      'marketing-docs/.astro/**',
      'marketing-docs/dist/**',
      'dist-electron/**',
      'release/**',
      // R0 历史兼容探针产物保留；正式 pi 源码在 electron/harness/runtime/pi 参加 lint。
      'experiments/pi-agent-runtime/dist/**',
      'experiments/pi-agent-runtime/release/**',
      'node_modules/**',
      // Vite 预打包依赖缓存（vite.config cacheDir = .tmp/vite）——第三方 bundle，非源码，不 lint。
      '.tmp/**',
      // 根目录 `wrangler dev` 的本地状态与打包产物（与 .gitignore 的 /.wrangler/ 同一件事）。
      '.wrangler/**',
      'build/**',
      'public/**',
      // TypeScript compiler spillover in the renderer tree (the source of truth is .ts/.tsx;
      // these CommonJS files/maps are rebuildable and must not become product source or lint input).
      'src/**/*.js',
      'src/**/*.js.map',
      'marketing/**',
      'coverage/**',
      // 本地走查/探针输出目录（gitignored，含临时诊断 .mjs）——非源码，不 lint。
      '.pose-lab/**',
      'tests/transport-spike/**',
      // 3D 预设动作校准台：仅 dev 工具（vite 不打包，独立 Three.js 渲染页），非产品源码，不纳入 lint/token 门禁。
      'src/devlab/**',
      // 技能(Claude Skill)安装产物:脚本是独立运行体(require/window/node 全局),非本项目源码,不纳入 lint。
      '.agents/**',
      '.claude/**',
      '.hermes/**',
      'skills/**',
      // 研究产物中的原型脚本（可独立运行的 ESM 采集/校验器）——非产品源码，不 lint。
      'docs/research/**/prototype/**',
      // 归档的实测证据（docs/evidence/<日期>-<主题>/）：当时那次测量的**原件**，含可独立运行的
      // .mjs 计时脚本（Node 全局、自带未用变量）。它们在仓库里的唯一价值是可核对——
      // 按 lint 改一个字，它就不再是「当时那次运行的记录」了。非产品源码，不 lint。
      'docs/evidence/**',
      // design-sync（组件库同步）：.ds-sync 是外部技能暂存的转换器脚本、ds-bundle 是它的构建产物、
      // .design-sync/support 是本地构建脚本+压平后的 CSS——三者都 gitignored，是构建工具不是产品源码，不 lint。
      // （.design-sync/previews/ 是手写的预览组合，走 tsx，保持被 lint。）
      '.ds-sync/**',
      'ds-bundle/**',
      '.design-sync/support/**',
      '**/*.config.{js,ts,mjs,cjs}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 脚本、走查、评测：Node 脚本，但走查里 page.evaluate 的回调体是页内代码，两套全局都给（同下面 tests/perf）。
    // 不设 sourceType：.cjs 由 ESLint 默认按 commonjs 解析。
    files: SCRIPT_LIKE_FILES,
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['tests/network/**/*.{cjs,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // agent-runtime 下的 .mjs 是 Node 脚本（实验分析器之类），和 tests/network 同类：
    // 它们用 console / process / URL，不是页内代码。
    files: ['tests/agent-runtime/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // 反馈接收端跑在 Cloudflare Workers 运行时里：`Request`/`Response`/`URL`/`TextEncoder`/
    // `crypto` 在那儿是真的全局，不是我们忘了 import。所以声明环境，而不是在九行上各写一条
    // eslint-disable —— 逐行 disable 会把「这个文件跑在哪个运行时」这条事实藏起来，
    // 下一个人加第十行时还得重新发现一次。
    // 它的测试用 node --test 跑（`check:feedback-worker`），所以 node 全局也给上。
    files: ['infra/feedback-worker/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.serviceworker, ...globals.node },
    },
  },
  {
    // 画布规模基准（tests/perf/）：Node 脚本，但 page.evaluate 的回调体是**页内**代码，
    // document / window 在那里合法。两套全局都给，而不是把整个目录塞进上面的 ignores——
    // tests/ux/** 当年整体豁免是因为那批文件把页内代码写成字符串，ESLint 根本看不见；
    // 这里的页内代码是真回调，看得见就该继续查 no-undef（少写一个字母仍要红）。
    files: ['tests/perf/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // The regression must enter through Electron CommonJS before loading the
    // native pi ESM island; require is intentional here, not application style.
    files: ['tests/network/**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // 所有 JS 文件都至少带全仓选择器（Playwright 不等待）；TS 文件由下面的 TS 块带上。
    files: ['**/*.{js,mjs,cjs}'],
    rules: { 'no-restricted-syntax': restrictedSyntax() },
  },
  {
    // windowsPathSelectors 还没作用到 scripts / tests/ux / evals 的 JS（2026-10-22 这三片刚进 ESLint，先只开 Playwright 不等待）；
    // 那里的平台路径问题归门岗换底层线，见 docs/fixes/2026-10-07-windows-local-gates.root-cause.json。
    files: ['docs/design/**/*.mjs'],
    rules: { 'no-restricted-syntax': restrictedSyntax(...windowsPathSelectors) },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // —— 红牌：违反即 bug（会让 React 崩溃 / 行为错乱）——
      'react-hooks/rules-of-hooks': 'error',

      // —— 黄牌：存量债 / 质量建议，先提示不阻断 ——
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'no-empty': 'warn',
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'no-regex-spaces': 'warn',
      'no-misleading-character-class': 'warn',
      'no-control-regex': 'warn',
      // 全角空格多见于中文文案与净化器正则（promptSanitize 有意匹配）→ 先 warn，非崩溃。
      'no-irregular-whitespace': 'warn',
      'preserve-caught-error': 'warn',
      'prefer-const': 'warn',
      'no-restricted-syntax': restrictedSyntax(...windowsPathSelectors, ...storeSelectorSerializeSelectors),
    },
  },
  {
    // 走查夹具（tests/ux/**/*.tsx）是一次性挂载的测试页，不是热更新的产品组件，这条只对产品有意义（放在 TS 块之后才压得住它的 warn）。
    files: ['tests/ux/**/*.{ts,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': restrictedSyntax(...testFileRestrictedSyntax) },
  },
  {
    // 存量基线之外的测试文件才拦用例体 / 钩子里的 await import；基线里的文件逐个迁完就从 JSON 里删掉。
    files: ['**/*.test.{ts,tsx}'],
    ignores: coldImportBaselineFiles,
    rules: { 'no-restricted-syntax': restrictedSyntax(...testFileRestrictedSyntax, ...coldImportSelectors) },
  },
  {
    // 画布 nodes / edges 整表订阅：名单外的文件一处都不许有；名单内的处数由 scripts/canvas-store-subscriptions.test.mjs 卡死（只减不增）。
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**', ...Object.keys(WHOLE_TABLE_SUBSCRIPTION_BASELINE)],
    rules: { 'no-restricted-syntax': restrictedSyntax(...windowsPathSelectors, ...storeSelectorSerializeSelectors, ...WHOLE_TABLE_SUBSCRIPTION_SELECTORS) },
  },
  {
    // 画布壳不订阅选区：选中一张卡，壳 0 次重渲（方向检查 2026-10-16-canvas-shell-subscriptions）。
    files: [CANVAS_SHELL_FILE],
    rules: { 'no-restricted-syntax': restrictedSyntax(...windowsPathSelectors, ...storeSelectorSerializeSelectors, ...SHELL_SELECTION_SELECTORS) },
  },
  {
    // 渲染层失败证据只有一个出口：src/desktop/rendererLog.ts（→ 主进程日志 → 诊断包）。
    // console.error/warn 在打包版里没人接——2026-09-24 用户诊断包里看得到「保存失败」、看不到为什么，就是这么丢的。
    // 硬零（存量 54 处已全部迁完）；log/info/debug 不是失败证据，放行。主进程那一半由 check:main-console 守。
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**', 'src/desktop/rendererLog.ts'],
    rules: { 'no-console': ['error', { allow: ['log', 'info', 'debug'] }] },
  },
  {
    // Alias ESLint's core rule, as above: independent options cannot be overwritten
    // by quit lifecycle exemptions and do not extend those rules to new file types.
    files: ['electron/**/*.{ts,tsx,mts,cts,js,mjs,cjs,jsx}'],
    ignores: ['electron/**/*.{test,spec}.{ts,tsx,mts,cts,js,mjs,cjs,jsx}', 'electron/**/__tests__/**'],
    plugins: { 'main-sync-wait': mainSyncWaitPlugin },
    rules: { 'main-sync-wait/no-restricted-syntax': ['error', ...mainSyncWaitSelectors] },
  },
  {
    files: ['electron/**/*.{ts,tsx}'],
    ignores: ['electron/**/*.test.{ts,tsx}', 'electron/**/__tests__/**', 'electron/quitTeardown.ts', ...directQuitExemptionFiles],
    rules: { 'no-restricted-syntax': restrictedSyntax(...windowsPathSelectors, ...quitLifecycleSelectors, ...directQuitSelectors) },
  },
  {
    // Exemptions still may not subscribe to the quit lifecycle.
    files: directQuitExemptionFiles,
    rules: { 'no-restricted-syntax': restrictedSyntax(...windowsPathSelectors, ...quitLifecycleSelectors) },
  },
  {
    files: ['electron/quitTeardown.ts'],
    rules: { 'no-restricted-syntax': restrictedSyntax(...windowsPathSelectors) },
  },
  {
    // 付费确认框（`useSpendConfirmStore.requestConfirm`）只有一扇门：「这一笔问不问用户」的 owner
    // `src/workbench/generationCanvas/spend/spendConfirm.ts`（概念 spend.confirmation-requirement）。
    // 2026-10-16 真付费验收：分镜方案整批生成直接调了 requestConfirm，绕过 owner，「直接生成」档对它完全不起作用，
    // 而且没有任何东西会红。下面这几处是允许的调用者——它们只**展示主进程已经做出的决定**，自己不判问不问：
    //   capabilityApplyHandler.ts + generationGateConfirm.ts（MCP 生成闸 / 计划门）、credentialProbeSpendCard.ts（接入页凭据试跑）、
    //   promptExtractionSpendCard.ts（浏览器提取提示词：主进程每次经 confirmSpendAndMintGrant 问人，卡只展示）、
    //   uncertainPriorTrialSpendCard.ts（试跑开新单而上一笔结果不确定：同样由主进程经 confirmSpendAndMintGrant 问人，卡只展示）、
    //   useProductionStatus.ts（制作流程门）；SpendConfirmDialog.tsx / NomiStudioApp.tsx 是 E2E 驱动桥。
    // 新增调用者 = 又一处自己决定弹不弹付费框 → 红；要么经 owner，要么先让主进程做决定、再登记进这张表。
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/**/*.test.{ts,tsx}', 'src/**/__tests__/**',
      'src/workbench/generationCanvas/spend/spendConfirm.ts',
      'src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx',
      'src/workbench/NomiStudioApp.tsx',
      'src/workbench/capability/capabilityApplyHandler.ts',
      'src/workbench/capability/generationGateConfirm.ts', // 从 capabilityApplyHandler.ts 拆出的 MCP 生成确认卡：只展示主进程决定的挑战
      'src/workbench/capability/credentialProbeSpendCard.ts',
      'src/workbench/capability/promptExtractionSpendCard.ts',
      'src/workbench/capability/uncertainPriorTrialSpendCard.ts',
      'src/workbench/production/useProductionStatus.ts',
    ],
    rules: {
      'no-restricted-properties': ['error', {
        property: 'requestConfirm',
        message: '付费确认框只经 owner 弹：用 src/workbench/generationCanvas/spend/spendConfirm.ts 的 confirmGenerationSpend / confirmStoryboardPlanBatch；只展示主进程决定的调用者才登记进 eslint.config.mjs 的允许表。',
      }],
    },
  },
  {
    // 渲染层直调 nomi:tasks:run 只有一扇门（见上面 ⑤）：名单外的渲染层文件一处都不许有；只有这一个块配置 task-run-bridge/*。
    files: TASK_RUN_BRIDGE_FILES,
    ignores: TASK_RUN_BRIDGE_IGNORES,
    plugins: { 'task-run-bridge': taskRunBridgePlugin },
    rules: { 'task-run-bridge/no-restricted-syntax': ['error', ...TASK_RUN_BRIDGE_SELECTORS] },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**', 'src/workbench/assets/assetFileDeletion.ts'],
    plugins: { 'asset-file-owner': { rules: { 'no-restricted-syntax': builtinRules.get('no-restricted-syntax') } } },
    rules: { 'asset-file-owner/no-restricted-syntax': ['error',
      { selector: "MemberExpression:matches([property.name='deleteFiles'], [property.value='deleteFiles'])", message: 'Physical file trash belongs to assets/assetFileDeletion.ts; UI must use the shared asset deletion command.' },
      { selector: "Property:matches([key.name='deleteFiles'], [key.value='deleteFiles'])", message: 'Do not alias the physical file deletion bridge outside assets/assetFileDeletion.ts.' },
    ] },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**', 'src/workbench/assets/assetFileDeletion.ts', 'src/workbench/assets/deleteAssetResult.ts', 'src/workbench/assets/pendingAssetDeletions.ts'],
    plugins: { 'asset-command-owner': { rules: { 'no-restricted-imports': builtinRules.get('no-restricted-imports') } } },
    rules: { 'asset-command-owner/no-restricted-imports': ['error', { patterns: [{ group: ['**/assetFileDeletion'], importNames: ['trashProjectFiles'], message: 'UI must request the asset deletion command; physical trash is private to the deletion domain.' }] }] },
  },
  {
    // TipTap 编辑器只有一扇门：useNomiTiptapEditor（固定 React 19 下的生命周期选项）。
    // 直接用 useEditor 会绕开它——2026-09-28 画布提示词编辑器选区不同步就是两套默认值各自为政。
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/workbench/common/useNomiRichTextEditor.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@tiptap/react', importNames: ['useEditor'], message: '用 useNomiTiptapEditor（src/workbench/common/useNomiRichTextEditor.ts），它固定了编辑器生命周期选项。' }],
      }],
    },
  },
  {
    // 浏览器夹具测试起开发服务只有一扇门（见上面 ③）；只有这一个块配置这两个规则 id。
    files: BROWSER_FIXTURE_TEST_FILES,
    plugins: { 'browser-fixture': browserFixturePlugin },
    rules: {
      'browser-fixture/no-restricted-imports': ['error', { paths: [{ name: 'vite', importNames: ['createServer'], message: RAW_VITE_SERVER_MESSAGE }] }],
      'browser-fixture/no-restricted-syntax': ['error', { selector: "ImportExpression[source.value='vite']", message: RAW_VITE_SERVER_MESSAGE }],
    },
  },
  {
    // 界面不印金额（见上面 ④）：名单外的渲染层源码一处金额格式化都不许有。
    files: UI_MONEY_FILES,
    ignores: [...UI_MONEY_TEST_FILES, ...Object.keys(MONEY_FORMAT_EXITS)],
    plugins: { 'ui-money': uiMoneyPlugin },
    rules: { 'ui-money/no-restricted-syntax': ['error', ...MONEY_FORMAT_SELECTORS] },
  },
  {
    // 界面拿不到格式化成货币的函数：只有名单里的文件能 import 它（见上面 ④）。
    files: UI_MONEY_FILES,
    ignores: [...UI_MONEY_TEST_FILES, FORMAT_MONEY_MODULE, ...Object.keys(FORMAT_MONEY_IMPORTERS)],
    plugins: { 'ui-money': uiMoneyPlugin },
    rules: { 'ui-money/no-restricted-imports': ['error', { patterns: [FORMAT_MONEY_IMPORT_PATTERN] }] },
  },
  {
    // Playwright isVisible / isHidden 不许当值取出来（见上面 playwrightAliasSelectors 的说明）；只有这一个块配置这个规则 id。
    files: PLAYWRIGHT_ALIAS_FILES,
    plugins: { 'playwright-wait': playwrightAliasPlugin },
    rules: { 'playwright-wait/no-restricted-syntax': ['error', ...playwrightAliasSelectors] },
  },
  prettier,
)
