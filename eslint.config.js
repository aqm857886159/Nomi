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
      'node_modules/**',
      'build/**',
      'public/**',
      'marketing/**',
      'coverage/**',
      'scripts/**',
      'tests/ux/**',
      'tests/transport-spike/**',
      '**/*.config.{js,ts,mjs,cjs}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
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
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
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
  prettier,
)
