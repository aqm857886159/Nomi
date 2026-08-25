# design-sync — Nomi 仓库专属笔记

> 每次 re-sync **先读这份**。它记的是「这个仓库特有的坑」，不是通用流程（通用流程看 skill）。

## 这个仓库的形状（为什么配置长这样）

- **Nomi 不是一个发布出去的 npm 包**，是一个私有 Electron App。`src/design/` 是它的内部设计系统。
  因此 `pkg: "nomi"` 只是个名字，**没有 `dist/`、没有 build 产物、没有 `.d.ts` 树**——
  转换器走的是 **synth-entry 模式**：从 `srcDir: "src/design"` 直接合成入口。
- 因为是 synth-entry，`componentSrcMap` 必须**逐个手写**（40 条）。`src/design/index.ts` 是
  barrel，一个文件导出多个组件（`actions.tsx` 出 5 个、`forms.tsx` 出 7 个、`status.tsx` 出 5 个），
  模糊查找按 `<Name>.tsx` 找不到它们。**加新组件到 `src/design/` 后，必须往 `componentSrcMap`
  里补一条**，否则它不会出现在组件库里。
- `tsconfig: "tsconfig.app.json"` —— esbuild 靠它解析 `@/…` 路径别名。用根 `tsconfig.json` 不行
  （它是 references-only 的壳，没有 `compilerOptions.paths`）。

## CSS：为什么有 `.design-sync/support/build-css.mjs`

Nomi 没有「编译好的库样式表」可以指给 `cssEntry`——样式散在 Tailwind 指令、
`src/styles/` 全局 CSS、Mantine 的包内 CSS 三处。转换器只会把 `cssEntry` **原样拷贝**成
`_ds_bundle.css`，里面任何相对 `@import` 都会悬空 → `[CSS_IMPORT_MISSING]` → 每张卡裸奔。

所以 `support/build-css.mjs` 用 esbuild 把整个 `@import` 图**压平成一个自包含文件**
`support/styles.generated.css`（~620KB），`cssEntry` 指它。

- **`styles.generated.css` 是生成物**（已 gitignore 掉？没有——它在 `support/` 下，
  见下面「提交范围」）。**源码里的样式改了，要手动重跑**：
  ```bash
  node .design-sync/support/build-css.mjs
  ```
  然后才重跑 `package-build.mjs`。忘了跑 = 组件库里的样式停留在上次同步那天。
- 里面包含全部 42 个 `--nomi-*` token + Tailwind utilities + Mantine 组件 CSS。
- `url(...)` 字体引用故意不内联（会把 ~2MB woff2 变成 base64 塞进每个设计）；字体走
  `cfg.extraFonts` 单独拷进 `fonts/`。

## Provider：`src/design/previewHost.tsx`（这是产品源码，不是脚手架）

`src/design` 里很多组件直接 `useTranslation()`（identity.tsx 那一族、NomiSelect、
ConfirmDialogHost…），另有一大半是 Mantine 封装、要 `MantineProvider` 才拿得到主题。
真 App 由 `src/NomiAppProviders.tsx` 提供这两层，但那个文件 import 了 `src/i18n`
（→ Electron desktop bridge）和 ModalsProvider/Notifications，**在浏览器沙箱里跑不起来**。

`NomiPreviewHost` 是同一套配置的**最小复刻**：同一份 `resources`、同一个 `buildNomiTheme()`。
不是并行实现（P1）——它不参与 App 渲染路径，两者共用那两个真相源。
配在 `cfg.provider`。它自己也被当成一个「组件」导入（floor card），这是正常的。

- 它会往 `document.documentElement` 上落 **三个**属性：`data-theme`（Tailwind `dark:` 变体读）、
  `data-nomi-color-scheme`、`data-mantine-color-scheme`（token 暗色块钉在它上面）。
  少写哪个，哪一层就不翻主题——和 `src/theme/colorScheme.ts` 保持一致。

## 字体

`extraFonts` 指向 `node_modules/@fontsource-variable/{inter,fraunces}/wght.css`——
Inter 是正文、Fraunces 是 display。中文字体走系统栈，所以 `runtimeFontPrefixes` 里列了
`PingFang` / `Hiragino` / `-apple-system` 等，压掉 `[FONT_MISSING]` 噪音（它们本来就不该随包发）。

## 已知的非阻断告警

- **`[TOKENS_MISSING]` 78 个**：绝大多数是 Mantine 在运行时用 inline style 设的变量
  （`--affix-*`、`--text-color`、`--text-line-clamp`…），静态样式表里本来就不该有。
  **这是预期的，不用追**。validate 仍然 exit 0。

## 预览卡的坑

- **overlay 一族必须配 `cfg.overrides.<Name>: {cardMode:"single", viewport:"WxH"}`**，
  否则展开态要么逃出卡片、要么塌成 0 高。已配：DesignModal / DesignDrawer /
  ConfirmDialogHost / NomiSelect / TooltipContent / **Tooltip / TooltipProvider /
  TooltipTrigger / BodyPortal / DesignPageShell**。
  判据是「**这东西会不会 portal 出去或撑满视口**」：Radix Tooltip 四件套全走 Portal、
  BodyPortal 顾名思义、DesignPageShell 带 min-h-screen——这五个 2026-08-26 补上，
  之前只配了前五个。
- **`ConfirmDialogHost` 的预览要用真 store 驱动**，不是摆一个静态壳：
  挂上 `<ConfirmDialogHost />`，再在 `useEffect` 里调 `confirmDialog()/alertDialog()/promptDialog()`
  （都从 `'nomi'` 导出）。这样走的是和生产完全同一条渲染管线
  （store → Host → DesignModal → Mantine Modal），不是仿造的卡。
- **Tooltip 一族要传受控 `open`**：hover 态截图截不到，靠 `<Tooltip open>` 让气泡常开。
  `TooltipTrigger` 必须配 `asChild`，否则会多套一层 button（嵌套按钮不合法且样式打架）。
- **`DesignPageShell` 预览要加 `className="min-h-0"`** 抵消它自带的 `min-h-screen`，
  否则卡里是一大片空白。
- **按钮/徽标一族配了 `viewport: "900x280"`**——它们是一排小控件，默认视口会把变体挤成多行、
  截图上下留一大片白。
- **`NomiSelect` 的下拉展开态渲染不出来**：它是 hover/click 驱动的 portal 浮层，静态卡里
  只能展示触发 pill。同理 Tooltip 的浮层、Drawer 的滑入动画。这些在预览里**只展示静态可达的那一面**。
- 预览里可以直接 `import { IconXxx } from '@tabler/icons-react'`——它在仓库 node_modules 里，
  esbuild 能解析。真实调用点也是这么用的。

## 预览创作的经验（2026-08-26 这轮攒的）

- **考据优先于发明**：`grep -rn "<Name>" src --include="*.tsx" | grep -v "^src/design/"`
  找真实调用点，读那些调用点再写。仓库里有 **118 个文件** import 自 `src/design`，
  素材足够——真实文案（「新建空白项目」「从一段文字或想法开始」「引导/平衡/策略自动」）
  都能从 `src/i18n/resources.ts` 和 `src/i18n/locales/*.ts` 里查到。
- **空输入框在卡上几乎看不见**（就是一条细线），表单类一律给**有值**的常态。
- **受控组件要写 `Demo` 壳**（内部 `useState`），否则点不动、也显示不出选中态。
- **hover / 展开浮层 / 滑入动画截图截不到**。Tooltip 一族的做法：给 `Tooltip` 传受控
  `open`，让气泡常开；Modal/Drawer 直接 `opened`。
- **构建很慢**：单个 preview 首次 ~4 分钟（esbuild 要打整个 Mantine + i18n + tabler 图标图），
  缓存热了之后快很多。分批跑、别一次性全量重建。这台机器常有 20+ worktree 并行，
  load average 上到 10+ 时更慢——**慢不等于挂了**，用
  `ps -o %cpu -p $(pgrep -f esbuild)` 看它是不是真在算。

## Floor card（未授权预览）现状

以下组件目前是 floor card（「preview not yet authored」的排版块）。**floor card 不是失败**，
是「还没给它写预览」的诚实基线，任何一次 re-sync 都可以增量补上：

（见文末「本轮状态」——每轮更新）

## 提交范围

committed：`design-sync.config.json`、`.design-sync/NOTES.md`、`.design-sync/previews/`、
`.design-sync/support/build-css.mjs` + `ds-entry.mjs` + `styles.css`（可复现的**输入**）、
`src/design/previewHost.tsx`（产品源码，见上）。
gitignored：`.ds-sync/`、`ds-bundle/`、`.design-sync/.cache/`、`.design-sync/learnings/`、
**`.design-sync/support/styles.generated.css`**（620KB 生成物——脚本进库、产物不进库）。

## eslint 必须忽略 design-sync 的工具目录（2026-08-26 踩到）

第一次跑 `pnpm run gates` 直接红：**1570 个 lint error**。全部来自
`.ds-sync/`（技能暂存的转换器脚本）、`ds-bundle/`（构建产物）、
`.design-sync/support/`（本地构建脚本 + 620KB 压平 CSS）——**产品源码零错误**。
根因：这三个目录虽然 gitignored，但 eslint 的 flat config 不读 `.gitignore`。

已在 `eslint.config.js` 的 `ignores` 里加了这三条（和既有的 `.claude/**`、`scripts/**`、
`skills/**` 同一个理由：构建工具不是产品源码）。**`.design-sync/previews/` 故意不忽略**——
那是手写的 tsx，该被 lint 管。

下次在新机器/新 worktree 重跑时，如果 gates 又红成这样，先看错误文件路径是不是全在这三个目录里。

## ⚠️ 后台任务的 exit code 会骗人

跑 gates 时后台任务通知报「completed (exit code 0)」，实际日志末尾是
`ELIFECYCLE Command failed with exit code 1`。**以日志内容为准，别信通知里的 exit code**
（仓库记忆里已有同类记录：管道跑测试会吞掉退出码）。

## Playwright / chromium

render check 要 playwright + chromium。本机 chromium 装在 **`~/Library/Caches/ms-playwright/`**
（macOS 路径，**不是** skill 里写的 `~/.cache/ms-playwright/`——按那个路径 `ls` 会以为没装）。
仓库 pin 的是 `playwright@1.60.0`，`.ds-sync/` 里装同一版本即可对上 chromium-1234。

```bash
(cd .ds-sync && npm i playwright@1.60.0 && npx playwright install chromium)
```

## Re-sync 风险（下一轮要盯的）

1. **`styles.generated.css` 会静默过期**——它是某一时刻样式的快照。改了 `src/styles/`、
   Tailwind 配置、或 Mantine 版本后没重跑 `build-css.mjs`，组件库看起来一切正常但样式是旧的。
   **每次 re-sync 无脑先跑一遍 build-css.mjs**，成本几秒。
2. **`componentSrcMap` 手写 40 条会和源码漂移**——`src/design/` 加了新组件而没补这里，
   新组件静默缺席，没有任何报错。re-sync 时对一下 `src/design/index.ts` 的导出列表。
3. **预览里内联的业务数据会过期**——比如 NomiSelect 预览里写死的模型名/价格
   （Seedream 4.0 ¥0.28…）。模型下架或改价后，卡上就是旧信息。这些是**展示用的示意数据**，
   不是真相源；但别让它离谱到误导人。
4. **`previewHost.tsx` 与 `NomiAppProviders.tsx` 可能漂移**——真 App 加了新的 provider 层
   （比如又一个 context），预览宿主没跟上，相关组件就会在卡里报 context 错。
   加 provider 时记得看一眼这个文件。
5. **上传从未跑过**（见「本轮状态」）——`projectId` 尚未写进 config。
