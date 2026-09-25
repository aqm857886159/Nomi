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

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      // R0 历史兼容探针产物保留；正式 pi 源码在 electron/harness/runtime/pi 参加 lint。
      'experiments/pi-agent-runtime/dist/**',
      'experiments/pi-agent-runtime/release/**',
      'node_modules/**',
      // Vite 预打包依赖缓存（vite.config cacheDir = .tmp/vite）——第三方 bundle，非源码，不 lint。
      '.tmp/**',
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
      'scripts/**/*',
      '!scripts/check-vocabularies*.mjs',
      'tests/ux/**',
      'tests/transport-spike/**',
      'evals/**',
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
    files: ['scripts/check-vocabularies*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
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
    },
  },
  {
    // 渲染层失败证据只有一个出口：src/desktop/rendererLog.ts（→ 主进程日志 → 诊断包）。
    // console.error/warn 在打包版里没人接——2026-09-24 用户诊断包里看得到「保存失败」、看不到为什么，就是这么丢的。
    // 硬零（存量 54 处已全部迁完）；log/info/debug 不是失败证据，放行。主进程那一半由 check:main-console 守。
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**', 'src/desktop/rendererLog.ts'],
    rules: { 'no-console': ['error', { allow: ['log', 'info', 'debug'] }] },
  },
  prettier,
)
