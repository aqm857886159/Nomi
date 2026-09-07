# 设计系统优化（2026-09-07）

> 状态：🚧 进行中（A/B/C 三档实施中，D 只出方案）

> 起因：用户要求「看一下设计系统，思考可以优化的地方，尤其从用户体验角度和设计角度」。
> 三路并行体检（token 层 / 组件采纳率 / 交互一致性）后由用户拍板范围：**A+B+C 全做 · D 只出方案 · 设计实验室补 primitive 屏**（暗色基线这轮不动）。

## 0. 一句话诊断

**Nomi 的设计系统是一本严谨的「值的字典」，还不是一套「组件的权威」。**

机器能量的三样（颜色 / 字号 / 圆角）已经满分——`check:tokens` 四类棘轮全 `0/0/0/0`，`check:dangling-tokens` 扫 1773 文件零悬空，色相漂移有算法级防线，token 镜像有测试守（`scripts/colorMixHue.test.mjs:106`）。

而所有让界面「不像一个东西」的原因，全部住在门岗看不见的那几层：

| 层 | 有 token | 有门岗 | 现状 |
|---|---|---|---|
| 颜色 / 字号 / 圆角 | ✅ | ✅ 棘轮=0 | 满分 |
| 间距 | ❌ Tailwind 侧没接 | ❌ | 126 处任意 px 逃逸 |
| 动效 | ⚠️ 有但坏 | ❌ | 77 处计算值 `0s`（见 A1） |
| z-index | ⚠️ 是 TS 常量，className 用不了 | ❌ | 196 处 `z-[N]`，2 处 `z-[9999]` 压过确认弹窗 |
| 组件 | ✅ 33 个 | ❌ | 按钮采纳率 37%、弹窗 14%、10 个组件零调用 |
| 状态四态 | 📄 只在文档 | ❌ | error/loading 两处被 empty 冒名顶替 |

## 1. 范围

### A 卫生（无设计争议）

| # | 内容 | 关键证据 |
|---|---|---|
| A1 | 拆 `--nomi-transition-fast` → `--nomi-duration-fast` + `--nomi-ease-fast`，改 77 处 className | `tailwind.config.ts:108` 把时长和缓动打包成一个值；`transition-duration: var(...)` 浏览器实测 computed `0s`（不是回退 150ms，是完全没有过渡）；77 处全部同时声明了 transition-property，即全部是「设计成要动、实际硬切」 |
| A2 | 删死 token（`--tc-*` 39 个 / `--handle-color-*` 8 个 / 其余零消费者），约占 token 表 42% | `tailwind.config.ts:183-255`；且这堆定义里的硬编码 hex 一直合法存活（门岗只管 className 里的 `-[#hex]`） |
| A3 | 删运行时不加载的全局 CSS，修样张夹具过期注释 | `src/styles/globals.css`(44) / `animations.css`(31) 无 import；`vendor-overrides.css:91-169` 与 `tailwind.config.ts:463-520` 逐字重复；`.design-sync/support/styles.css:12-14` 自称「app 运行时加载顺序」已过期 → 样张与真机在这 259 行上失真 |
| A4 | 修文档：§0.5 与 §14.1 的真相源矛盾、覆盖版本 v0.10.x→v0.21.0、§14.2 漂移清单重跑 | 同一份自称 single source of truth 的文档，在「值该写哪」上给了两个相反答案，相隔 1000 行 |

### B 补洞（用户会真实吃亏）

| # | 内容 | 关键证据 |
|---|---|---|
| B1 | 导出 MP4 按钮接 `exportBusy`：disabled + loading + `title` 说明为什么点不了 + 进度条补阶段文案与 `aria-valuenow` | 按钮 `src/ui/app-shell/NomiAppBar.tsx:355-372` 无任何忙态；忙态 `exportBusy` 在 `src/workbench/preview/TimelinePreview.tsx:122`，跨组件拿不到；点第二次被 `:248` `if (exportBusy) return` 静默吞掉。**这是设计系统 §1.6 C1 那条规则自己举的原型的同构复发** |
| B2 | `useLocalProjects` 透出 SWR 的 `error` / `isLoading`，项目库补 error + loading 态 | `src/workbench/library/localProjectStore.ts:82` 只解构 `{ data, mutate }`，`fallbackData: []` → 读取失败落进首启空库引导屏，用户看到的是「你一个项目都没有」 |
| B3 | 花钱确认弹层补 Esc + 焦点陷阱 + `role="dialog"`/`aria-modal`（或直接改走 `DesignModal`） | `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:94-108` 手写 `fixed inset-0`，只有背景点击关闭。**更重的决定（花钱）比更轻的决定（删除，走 `confirmDialog`）保障更差** |

### C 加门岗（防复发，R28「防线建在最早能拦住的那层」）

| # | 内容 | 基线 |
|---|---|---|
| C1 | 「任意 px 间距」棘轮，基线 126。**只补默认表没有的半档键**（3/5/7/9/18/22px），不整体接 `theme.extend.spacing`——见「先查别人」②，我们那 8 个值和 Tailwind 默认栅格逐值相同，接进去等于凭空造第二个真相源 | 126（`[6px]`×27 / `[5px]`×20 / `[3px]`×18 / `[2px]`×15 / `[1px]`×12 / `[7px]`×11；其中 70 处今天就能改写成既有默认类） |
| C2 | **先补出口再加棘轮**（顺序不许颠倒）：① 把 `NOMI_OVERLAY_Z_INDEX` 镜像成 CSS 变量并接进 `theme.extend.zIndex`，让 `z-dialog`/`z-confirmation` 成为可写类名；② 再加「`z-[N]`，**N≥50**」棘轮。阈值从 20 改到 50 的理由见「先查别人」③ | 34（实扫 197 处，163 处是 `z-[1..20]` 组件内局部序、生态说本就该这么写；34 处 ≥50 才与契约打架，其中 5 处压过 confirmation=9300：`NodeMediaPreviewDialog` / `NodeShotCutPanel` / `PanoramaViewer` / `ScreenshotCropOverlay` 的 `z-[9999]` 与 `AssetPreviewDialog` 的 `z-[10000]`） |
| C3 | `check:dangling-tokens` 补反向检查：定义了但零消费者 | A2 清完后归零 |

> C 三条都必须先验「加规则会红」再落基线（R17）。
>
> ⚠️ 上表 C1/C2 已按「先查别人」的结论改写过一次（2026-09-07）——原方案的 C1「整体接 spacing」与 C2「阈值 20」都被调研推翻。**表与调研结论是同一个答案，不是两份**。

### 实验室：补 primitive 屏

给 `src/design/` 那 33 个组件建一屏陈列（按钮全 variant×size、表单、弹层、状态、空态、身份标），录基线。
**动机**：现在 8 屏 134 张基线全是功能屏，零屏是共用积木——primitive 层的漂移只有等它出现在某个功能屏上才被看见。
（暗色基线本轮不做：134 张里只有 2 张暗色，补齐是独立一轮的事。）

### D 只出方案，不动码

写「设计系统从值的字典升级为组件权威」的方案，含影响面清单：

1. **缺失原语**：`Menu`（`role="menu"` 手写 **72 处 / 18 文件**，设计系统完全没有）、原生 `WorkbenchDialog`（手写 `role="dialog"` **30+ 文件**，含 `z-[3400]`/`z-[9999]` 绕过分层契约）、`Spinner`（`animate-spin` **13 处三套写法**并存，而 `NomiSkeleton` 零采纳 vs 9 处手写 `animate-pulse`）。
2. **词表统一**：`variant` / `tone` / `kind` / `color` 四个词表达同一个轴；`size` / `density` / `compact` 三个词表达同一个轴；四套互不兼容的 size scale，同一个 `sm` 在三处各硬编码一份。
3. **近重复合并**：`DesignSegmentedControl`(Mantine) vs `NomiSegmented`(原生)；`DesignButton`(Mantine) vs `WorkbenchButton`(原生) 的半途迁移；四份并行空态。
4. **文档主张与现实背离**（比没有主张更伤，新人照文档写会写出第五套）：
   - `src/design/AnchoredPopover.tsx:7,20` 自称「全站唯一一套浮层定位机制 / 新增浮层一律用它」→ 实际 4 个文件用，另有 Radix、Mantine、8 处手写 `getBoundingClientRect` 三套并行；
   - `src/design/emptyState.tsx:5` 称已收口空态 → 实际 4 份并行；
   - `src/design/README.md:12` 推销 `PanelCard`/`InlinePanel`/`DesignSelect` → 全仓 0 命中，这三个组件不存在。

## 先查别人

> 完整报告（四问逐条带出处）：[`docs/research/2026-09-07-design-system-optimization/prior-art.md`](../research/2026-09-07-design-system-optimization/prior-art.md)
> 自媒体附件：[`docs/research/2026-09-07-design-system-optimization/tikhub/tikhub-search.md`](../research/2026-09-07-design-system-optimization/tikhub/tikhub-search.md)（四平台 48 条，2026-09-07 实抓）

- **① 动效 token 分层 → 用已有，A1 方向正确。** Tailwind 3.4 默认 theme 本来就是两个 key（`node_modules/tailwindcss/stubs/config.full.js:934` / `:956`），MD3 是 duration/easing 两组独立 token（<https://m3.material.io/styles/motion/easing-and-duration/tokens-specs>），W3C DTCG 的 `transition` 是 composite type、三个子值各自独立（<https://www.designtokens.org/TR/drafts/format/>）——三家形状一致，我们原来那种拼字符串打包在标准里没有对应物。失效机制不是「回退 150ms」而是 CSS Variables §3.1 的 *invalid at computed-value time*，取 initial `0s`（<https://www.w3.org/TR/css-variables-1/#invalid-variables>）。「打包会让 duration 静默失效」这条坑**查不到公开记录**，如实记账。
- **② 间距 → 推翻 C1 的前半条。** `nomiDesignTokens.spacing` 的 8 个值（`src/theme/nomiTheme.ts:12`）与 Tailwind 默认栅格**逐值相同**，接进 `theme.extend.spacing` 是零信息量的重复定义、还多一个真相源（R29/R14.1）。126 处逃逸里 **70 处**（1/2/4/6/8/10/60px）今天就能改写成既有默认类，**56 处**（3/5/7/9/18/22px）才是默认表没有的半档值——要补也只补这些键。棘轮照加，基线 126。
- **③ z-index → 改 C2 的形状，且要先补出口。** 生态共识（Radix Themes「Don't use z-index values other than auto, 0, or -1」+ portal 分层，<https://www.radix-ui.com/themes/docs/overview/styling>；抖音/B站实践派同一分界：局部用 DOM order / `isolation: isolate`，全局浮层才用 token，<https://www.douyin.com/video/7652675982284934427>）说明「数字不该到处管层级」，但没否定「全局档位表」。实扫 197 处里 **162 处是 `z-[1..20]` 的组件内局部序**，只有 **34 处 ≥50** 在跟契约打架、其中 5 处 `z-[9999]`/`z-[10000]` 真的压过 `confirmation=9300`。⇒ 阈值改 **N ≥ 50**（基线 34）；并且**在加棘轮之前**先把 `NOMI_OVERLAY_Z_INDEX`（`src/design/overlayLayers.ts:7`）镜像成 CSS 变量并接进 `tailwind.config.ts` 的 `theme.extend.zIndex`（Tailwind 默认 zIndex 只到 50，`node_modules/tailwindcss/stubs/config.full.js:1051`，这一格是**真缺口**，与 ② 相反），否则棘轮是在给根因打补丁（P2）。browser 子系统那 21 处私有刻度归 D 档，不塞进本轮。
- **④ 反向 token 检查 → 自研，扩既有脚本。** 唯一对口的现成工具 [`@spectrum-tools/stylelint-no-unused-custom-properties@2.0.5`](https://www.npmjs.com/package/@spectrum-tools/stylelint-no-unused-custom-properties)（npm registry 实读，2025-03-20）只解析 CSS 文件，看不见我们真正的消费面——`tailwind.config.ts:766` 的 theme 映射与 `.tsx` 的 className；stylelint / knip / ts-prune 都不是本仓依赖。`scripts/check-dangling-tokens.mjs:9` 已经同时算出「定义集」与「引用集」，反向只是换个减法方向，且天然共用同一份「什么算引用」的语义。豁免照抄 Spectrum 的 `@passthrough` 注释思路，不发明新语法。

## 2. 不动项

- 暗色视觉基线（独立一轮）
- D 的任何生产代码
- 45 处硬编码中文报错的 i18n 迁移（属 R15 轨，不混进本轮）
- 云端生成「取消」能力本身（是产品功能不是设计系统；B1 只补导出按钮的忙态与说明）

## 3. 验收门

- `pnpm run gates` 全过（R11/R22）
- **A1 必须有真机走查证明动效真的活了**：截图证明不了 0ms→140ms，需在真实 Electron 里量 `getComputedStyle(el).transitionDuration`，改前 `0s` / 改后 `0.14s`，两个数字都进交付说明（P3：全绿≠完成）
- B1/B2/B3 各走一条真实用户任务走查（R13/R16），不是 expect 断言，是人眼判断
- C1/C2/C3 三条门岗各先验「会红」再落基线（R17）
- primitive 屏基线由用户拍板后才算数（UI 交付定义 = 设计实验室截图拍板 + 视觉基线绿）

## 4. 回滚

单分支 `claude/design-system-optimization-b44d66`，每档独立 commit（A1 / A2 / A3 / A4 / B1 / B2 / B3 / C / lab / D-doc），任一档出问题按 commit 粒度 revert。
