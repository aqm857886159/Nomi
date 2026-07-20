# i18n 国际化底座（zh-CN / en）

日期：2026-07-20

## 目标

- 为 Electron + React 渲染层接入统一 i18n 运行时。
- 默认语言固定为 `zh-CN`；仅支持 `zh-CN`、`en`，用户切换后本地持久化。
- 在全局可达的「关于 Nomi」面板提供语言切换。
- 首批迁移应用壳、项目库、关于/更新面板、通用错误与本轮涉及的 `@` 菜单等核心可见文案。
- 新增工程规则与自动门禁：新的可见文字不得继续硬编码；存量基线只减不增。

## 技术方案

- 采用 `i18next` + `react-i18next`，资源随应用内联打包，不引入网络语言包加载。
- `src/i18n/` 是唯一语言真相源：
  - `resources.ts`：`zh-CN` / `en` 翻译资源。
  - `index.ts`：初始化、支持语言列表、默认值、localStorage 持久化、`document.lang` 同步。
  - `i18next.d.ts`：翻译 key 类型约束。
- `NomiAppProviders` 注入 `I18nextProvider`，普通组件用 `useTranslation()`；React 外的 toast/命令用同一 i18n 实例 `i18n.t()`。
- 不自动跟随操作系统语言，避免首次行为不可预测；没有存储值时一律 `zh-CN`。

## 规则与门禁

- `CLAUDE.md` 与 `docs/engineering-rules.md` 增加 i18n 规则：所有用户可见文字（正文、按钮、菜单、placeholder、title、aria-label、toast、dialog、空态和错误提示）必须来自翻译资源。
- 新增 `scripts/check-i18n-visible-text.mjs`：扫描产品源码中的 JSX 可见文本、可访问性属性和已知通知调用。
- 现有未迁移文字记录为精确基线；门禁拒绝新增基线项，允许并鼓励删除存量项。
- `pnpm run gates` 纳入 `check:i18n`。

## 首批迁移范围

- 全局 Provider 与语言切换。
- `AboutNomiPopover`（含更新状态）。
- `NomiAppBar`、`WorkbenchShell` 的主导航/标题栏可见文案。
- `ProjectLibraryPage` 首屏项目库文案。
- `ErrorBoundary` / chunk boundary 等全局错误与加载提示。
- `AssetMentionSuggestionList` 及连接相关的用户提示。

## 不动项

- AI system prompt、模型提示词模板、供应商协议字段、项目数据中的用户内容不翻译。
- 本轮不做远程翻译平台、语言包热更新、自动系统语言检测。
- `docs/stats/downloads-history.json` 与 `public/tailwind.generated.css` 的现有未提交改动不纳入本次修改。

## 验收

1. 无语言存储时启动为中文；切到 English 后刷新仍为英文。
2. `document.documentElement.lang` 与当前语言一致。
3. 中文/英文下核心首屏、主导航、关于面板和项目库无 key 裸露。
4. 新增硬编码可见文本时 `pnpm run check:i18n` 失败。
5. `check:filesize`、`check:tokens`、`check:i18n`、`lint:ci`、`typecheck`、`test`、构建通过。
