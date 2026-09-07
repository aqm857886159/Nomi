# 「先查别人」报告：设计系统优化的四个「要不要自己造」（2026-09-07）

> 状态：📎 长期参考（R27 §16 必交物，随对应方案结案）
> 对应方案：[`docs/plan/2026-09-07-design-system-optimization.md`](../../plan/2026-09-07-design-system-optimization.md)
> 分支 `claude/design-system-optimization-b44d66`。本报告只回答「别人做过没有」，不替方案做实施决定。
> 第三方现状一律用 Context7 / 官方文档实查（版本号从 `package.json` 读：`tailwindcss@3.4.19`），不凭记忆。
> 查不到的明写「查不到」——它和「别人没做过」是两件事。

## 要回答的四个问题

1. **动效 token 该分层还是打包**（A1 已落地）——我们把 `--nomi-transition-fast` 拆成 duration + ease，是主流还是自创？
2. **间距要不要接进 Tailwind `theme.extend.spacing`**（C1 待做）——接了能解决那 126 处逃逸吗？
3. **z-index 分层该由什么承载**（C2 待做）——生态共识是「数字管层级」还是「数字不该管层级」？
4. **「定义了但零消费者」的反向 token 检查**（C3 待做）——有现成工具吗？

---

## ① 动效 token：分层是共识，打包是我们自己创的

### 依赖里已有？

- Tailwind 3.4 的默认 theme **本来就把两者分成两个 key**：`transitionDuration`（[`node_modules/tailwindcss/stubs/config.full.js:934`](../../../node_modules/tailwindcss/stubs/config.full.js)，`DEFAULT: '150ms'` + 75/100/150/…/1000）与 `transitionTimingFunction`（同文件 `:956`，`DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)'` + linear/in/out/in-out）。**框架里没有任何一个 key 接受「时长+缓动」合成的值**——我们那份打包 token 从来没有一个合法的落点。
- 现在的分层写法（[`tailwind.config.ts:766`](../../../tailwind.config.ts:766) `transitionDuration['nomi-fast']` / `:769` `transitionTimingFunction['nomi-fast']`）就是框架自带的形状，零自创。

### 仓库里已有？（这条同时是 A1 的根因证据）

- 打包形态在 main 上是 `tailwind.config.ts:108`（`git show origin/main:tailwind.config.ts | sed -n 108p`）：`'--nomi-transition-fast': '140ms cubic-bezier(.2, .7, .3, 1)'`。本分支同一行已换成 [`tailwind.config.ts:108`](../../../tailwind.config.ts:108) 的 `--nomi-duration-fast`。
- 调用点写的是 `duration-[var(--nomi-transition-fast)]`，`git grep -o 'duration-\[var(--nomi-transition-fast)\]' origin/main -- src | wc -l` = **77**（本分支迁移后 `duration-nomi-fast` 同为 77 处）。
- 机制不是「回退 150ms」，是**声明整条失效**：`transition-duration: 140ms cubic-bezier(...)` 对 `transition-duration` 是非法值，走 CSS Variables 规范 §3.1「Invalid Variables」的 *invalid at computed-value time* 路径——「the property containing the var() function is invalid at computed-value time」，属性取 initial 值，而 `transition-duration` 的 initial 是 `0s`（<https://www.w3.org/TR/css-variables-1/#invalid-variables>；`transition-duration` 的合法值只有 `<time>`：<https://developer.mozilla.org/en-US/docs/Web/CSS/transition-duration>）。
- main 上另有一处 `transitionTimingFunction['nomi-fast'] = var(--nomi-transition-fast)`（main `tailwind.config.ts:755-757`），同一个打包值塞进缓动键，同样非法、同样静默——**一个错误 token 在两个键上各错一次**，这正是「打包」这个决定本身的代价。

### 生态里已有？

- **Material Design 3**：duration 与 easing 是两组独立 token（`md.sys.motion.duration.*` 四档 short/medium/long/extra-long；`md.sys.motion.easing.*` 两族 Standard/Emphasized）——<https://m3.material.io/styles/motion/easing-and-duration/tokens-specs>。
- **W3C Design Tokens 格式规范**：`duration` 与 `cubicBezier` 是两个**独立 type**；`transition` 是 *composite type*，值必须是对象 `{ duration, delay, timingFunction }`，三个子值各自保持独立类型——<https://www.designtokens.org/TR/drafts/format/>。⇒ 标准里「打包」的合法形态是**结构化对象**，不是一个拼起来的字符串。我们原来那种拼字符串的打包，在标准里根本没有对应物。
- **有没有人公开记过「打包会让 `transition-duration` 静默失效」这条坑？** — **查不到**。搜到的只有「设计系统通常把 duration / easing 分开定义以避开 shorthand 解析歧义」这类一般性建议（MDN `transition` 简写的时间值分配规则：第一个 time 给 duration、第二个给 delay，<https://developer.mozilla.org/en-US/docs/Web/CSS/transition>），没有一条把它落到「computed 值变 0s、界面硬切」的具体现象上。⇒ 这条坑的公开记录是我们这份；如实记账，不假装引用别人。

### 结论

**用已有**（跟随 Tailwind theme key / MD3 / DTCG 的分层形状）。A1 方向正确，且它不是「我们的偏好」，是框架和标准都只提供这一种落点。

---

## ② 间距：C1 的前半条是重复定义，真缺口不在那里

### 依赖里已有？

- Tailwind 3.4 默认 spacing 栅格：[`node_modules/tailwindcss/stubs/config.full.js:841`](../../../node_modules/tailwindcss/stubs/config.full.js)——`px:1px, 0.5:0.125rem(2px), 1:4px, 1.5:6px, 2:8px, 2.5:10px, 3:12px, 3.5:14px, 4:16px, 5:20px, 6:24px, 7…96`。**半档只到 3.5**，之后全是整档。
- 官方覆盖姿势（Context7 实查 v3 文档）：`theme.extend.spacing` 加值、`theme.spacing` 整表替换；spacing 一改，padding/margin/gap/width/height/inset/translate/size 全族跟着变（<https://v3.tailwindcss.com/docs/customizing-spacing>、<https://v3.tailwindcss.com/docs/padding>）。

### 仓库里已有？

- `nomiDesignTokens.spacing` = `{1:4px, 2:8px, 3:12px, 4:16px, 5:20px, 6:24px, 8:32px, 10:40px}`（[`src/theme/nomiTheme.ts:12`](../../../src/theme/nomiTheme.ts:12)）。
- **它和 Tailwind 默认栅格逐值相同**（4px 一档，键名也对得上：`1→4px`…`10→40px`）。`tailwind.config.ts` 里**没有** `spacing` 键（`grep -n spacing tailwind.config.ts` 零命中）——也就是说 Tailwind 侧今天用的就是默认表，而默认表已经**逐值覆盖**了这 8 个 token。
- 126 处逃逸拆开看（`grep -rEo '\b(p|px|py|…|gap|space-[xy])-\[[0-9.]+px\]' src`）：
  | px 值 | 处数 | 默认栅格里有吗 |
  |---|---|---|
  | 1 | 12 | ✅ `px` |
  | 2 | 15 | ✅ `0.5` |
  | 4 | 6 | ✅ `1` |
  | 6 | 27 | ✅ `1.5` |
  | 8 | 6 | ✅ `2` |
  | 10 | 3 | ✅ `2.5` |
  | 60 | 1 | ✅ `15` |
  | **小计可直接改写** | **70** | |
  | 3 | 18 | ❌（0.75 档不存在） |
  | 5 | 20 | ❌（1.25） |
  | 7 | 11 | ❌（1.75） |
  | 9 / 18 / 22 | 1 / 2 / 4 | ❌（2.25 / 4.5 / 5.5） |
  | **小计真缺口** | **56** | |

### 生态里已有？

- Tailwind 官方讨论 [#12263 “A new default spacing scale”](https://github.com/tailwindlabs/tailwindcss/discussions/12263) 里核心团队自己的表述：即使跟好设计师合作也常要跳出默认栅格，硬凑反而更差——**但这不足以推翻「要有一套栅格」**。
- 用 Tailwind 的成熟设计系统（shadcn/ui 一族）默认**沿用**官方栅格，自定义的代价是：所有跟 spacing 联动的族（inset/size/translate/…）一起漂，且设计交付物要重新学一套刻度（<https://vercel.com/i/shadcn-vs-radix>）。

### 结论 → **部分推翻方案 C1**

- **删掉 C1 的前半条**「把 `nomiDesignTokens.spacing` 接进 `theme.extend.spacing`」：它写进去的 8 个值和 Tailwind 默认表**逐值相同**，产出是零信息量的重复定义，并且立刻制造第二个真相源（R1/R14.1「同一语义有几份定义」正好扫这个）。
- 真正要做的是三件：① 70 处直接改写成既有默认类（`p-[6px]`→`p-1.5`，今天就能改，不需要任何配置）；② 56 处半档值先逐处判「这 3px/5px/7px 是真需要还是随手写的」，确认要保留的才补**默认表里没有的**键（`0.75/1.25/1.75/4.5/5.5`）——这才是 `theme.extend.spacing` 的正当用途；③ 棘轮照加，基线 126。
- 判断依据不是偏好，是领域约束：**框架已经提供的东西不许再长一份**（R29）。

---

## ③ z-index：生态共识确实是「数字不该管层级」，但结论是「C2 量错了对象」，不是「不要门岗」

### 生态里已有？

- **Radix Themes 官方规范（最强的一条）**——「z-index conflicts」小节，原文两条规则：「Don't use `z-index` values other than `auto`, `0`, or `-1` in rare cases.」「Render the elements that should stack on top of each other in portals.」，机制是根 `<Theme>` 组件的样式建立一个层叠上下文，把主内容与 portal 内容隔开（<https://www.radix-ui.com/themes/docs/overview/styling>）。
- **Radix Primitives 反面证据**：早期版本自己管 z-index，后来明确改成「Z-index isn't managed anymore so you have full control of layering」，并把 portal 抽成独立 part（<https://github.com/radix-ui/primitives/issues/1317>、<https://www.radix-ui.com/primitives/docs/overview/releases>）。⇒ 连给出这条规范的人，自己也放弃了「库替你排数字」。
- **Tailwind 侧的对应事实**：默认 `zIndex` 表只有 `auto/0/10/20/30/40/50`（[`node_modules/tailwindcss/stubs/config.full.js:1051`](../../../node_modules/tailwindcss/stubs/config.full.js)）。我们的档位 4000 / 9000 / 9300 **全部在默认表之外**——这跟 ② 正好相反：spacing 是框架已给、我们重复；zIndex 是框架没给、我们真缺。

### 仓库里已有？

- 分层契约在 [`src/design/overlayLayers.ts:7`](../../../src/design/overlayLayers.ts:7)：`floatingPanel 4000 / applicationModal 9000 / dialog 9100 / popover 9200 / confirmation 9300 / feedback 2147483647`，且有单测钉住次序（[`src/ui/feedbackLayer.test.ts:29-46`](../../../src/ui/feedbackLayer.test.ts:29)）。
- 它是 **TS 常量**，className 里用不了；40 处引用全部走 TS/内联 style。仓库里**没有**任何 `--nomi-z-*` / `--nomi-layer-*` CSS 变量（`grep -rn 'nomi-z\|--nomi-layer' src tailwind.config.ts` 零命中），Tailwind 也没接 `zIndex` 键。⇒ **34 处越界不是纪律问题，是接口缺失**：className 里根本没有合法的说法（P2 根因）。
- 把 197 处 `z-[N]` 按量级拆开（`grep -rEo 'z-\[[0-9]+\]' src` 后按数值分档；另有 1 处落在 21–49 之间未单列）：
  | 量级 | 处数 | 性质 |
  |---|---|---|
  | `z-[1]`…`z-[20]` | 162 | 组件**内部**同一层叠上下文里的先后序——生态里正是「用 DOM order / `isolation` 解决，或用个位数」的那一类，**不是**跟全局契约冲突 |
  | `z-[50]`…`z-[600]` | 21 | 局部弹层与 browser 子系统自建的一套私有刻度（[`src/ui/browser/dialog/NomiBrowserDialogView.tsx:120`](../../../src/ui/browser/dialog/NomiBrowserDialogView.tsx:120) 起 520/560/570/575、[`BrowserAssetOverlayApp.tsx:446`](../../../src/ui/browser/overlay/BrowserAssetOverlayApp.tsx:446) 600） |
  | `z-[3400]`…`z-[4400]` | 8 | 自造中间档，插在 `floatingPanel 4000` 前后（[`OnboardingSpotlight.tsx:141`](../../../src/workbench/onboarding/OnboardingSpotlight.tsx:141) 3400/3401、[`JourneyTourController.tsx:31`](../../../src/workbench/onboarding/JourneyTourController.tsx:31) 3402、[`SpendConfirmDialog.tsx:130`](../../../src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:130) 3500、[`AnchorCheckpointCard.tsx:190`](../../../src/workbench/generationCanvas/spend/AnchorCheckpointCard.tsx:190) 4300/4400） |
  | `z-[9999]` ×4 / `z-[10000]` ×1 | 5 | **真的压过 `confirmation = 9300`**（[`ScreenshotCropOverlay.tsx:97`](../../../src/workbench/generationCanvas/components/ScreenshotCropOverlay.tsx:97)、[`NodeMediaPreviewDialog.tsx:57`](../../../src/workbench/generationCanvas/nodes/NodeMediaPreviewDialog.tsx:57)、[`NodeShotCutPanel.tsx:146`](../../../src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx:146)、[`PanoramaViewer.tsx:574`](../../../src/workbench/generationCanvas/nodes/PanoramaViewer.tsx:574)、[`AssetPreviewDialog.tsx:114`](../../../src/workbench/assets/AssetPreviewDialog.tsx:114)） |

### TikHub 自媒体（详见 §④ 附件）——实践派给的分界跟 Radix 一致

- 「真实项目里的 z-index 管理：项目里出现 z-index: 99、999、9999，通常说明层级关系已经缺少边界」，给的四条是：**纯装饰层级优先 DOM order / 交互内容保持 DOM order 稳定再显式 z-index / 组件内部用 `isolation: isolate` 限定比较范围 / 全局浮层用 z-index token 管 header 和 modal**（抖音 · 林想的Web工坊，2026-06-20，<https://www.douyin.com/video/7652675982284934427>；同作者 B 站同题 <https://www.bilibili.com/video/BV1f9jA6DEeN>）。
- 同作者另一条讲「z-index 设到 999999 也没用，原因在 Stacking Context」（<https://www.douyin.com/video/7650542081227771136>）——正好是我们那 5 处 `z-[9999]` 的心理动机：**看不懂为什么被盖住，就加零**。

### 结论 → **推翻 C2 现在的形状（阈值 20 + 单加棘轮），但不推翻「要有门岗」**

1. **阈值 20 量错了对象**：162/197 处是 `z-[1..20]` 的组件内局部序，生态共识明确说这类**就该**用小数字或 DOM order 解决，把它们记成债会让基线 90% 是假债，然后被无视（这正是 R27 注释里说的「门岗一上线就一片红然后被无视」）。**正确的判据是「N ≥ 50 的 `z-[N]` 必须来自 token」**，基线 34（21 + 8 + 5）。
2. **单加棘轮 = 给错误方案打补丁（P2）**：34 处绕过的根因是 className 侧没有合法出口。所以 C2 前面必须先补一步——把 `NOMI_OVERLAY_Z_INDEX` 镜像成 CSS 变量并接进 `tailwind.config.ts` 的 `theme.extend.zIndex`（框架默认只到 50，这一格是真缺口，与 ② 相反），先让 `z-overlay-dialog` 这类说法存在，再上棘轮。镜像必须有测试钉住 TS 常量与 CSS 变量一致（照 `scripts/colorMixHue.test.mjs` 的镜像测试手法），否则又是两个真相源。
3. **生态共识没有推翻「用数字」，它推翻的是「到处用数字」**：Radix 说「别用 auto/0/-1 之外的值」的前提是它自己用 portal + 根层叠上下文把全局分层解决掉了；我们是 Mantine + Radix + 手写 portal 三家混跑（`NOMI_OVERLAY_Z_INDEX` 同时喂 Mantine 的 `componentDefaults('Modal'/'Drawer'/'Popover'/'Menu')`，见 [`src/ui/feedbackLayer.test.ts:42-45`](../../../src/ui/feedbackLayer.test.ts:42)），**没有单一的根层叠上下文可依赖**——这是真实的领域约束，所以「保留全局档位表」是对的；错的是让它只活在 TS 里。
4. 顺带：browser 子系统那 22 处私有刻度（520/560/570/575/600）属于「另起一套平行分层」，归 D 档（组件权威）处理，不该塞进本轮 C2。

---

## ④ 反向 token 检查：现成工具存在，但它看不见我们的消费面

### 依赖里已有？

- **没有**。`stylelint` / `knip` / `ts-prune` 都不是本仓依赖（`package.json` 里 `stylelint|knip|prune|purge` 匹配到的只有 `postcss`）。
- 现有正向门岗：[`scripts/check-dangling-tokens.mjs:9-18`](../../../scripts/check-dangling-tokens.mjs:9) 已经在扫「定义」（`src/**/*.css` 的 `--x:` + TS/TSX 内联 style + `setProperty`）和「引用」（`src/**/*.{ts,tsx,css}` 与 `tailwind.config.ts` 里的 `var(--x)`），但只判「引用了未定义」，两个集合的另一个方向没用。

### 生态里已有？

- **有一个直接对口的**：[`@spectrum-tools/stylelint-no-unused-custom-properties`](https://www.npmjs.com/package/@spectrum-tools/stylelint-no-unused-custom-properties)（Adobe Spectrum 出品，latest `2.0.5`，2025-03-20 发布；npm registry 实读）。README 自述「Report on any unused custom property definitions」，还提供 `/* @passthrough */` 注释豁免「定义了给子组件用」的情形。
- **它替不掉我们要的东西**：它是 stylelint 插件，判据是「有没有在**某条 CSS 规则**里被 `var()` 引用」。而 Nomi 的 token 消费面主要在 CSS 之外——`tailwind.config.ts` 的 theme 映射（如 [`tailwind.config.ts:766`](../../../tailwind.config.ts:766)）、`.tsx` 的 `className` 任意值、内联 style。把它接上去的结果是几乎所有 token 都被报成 unused（假阳性淹没），而它连 `tailwind.config.ts` 都不解析。
- stylelint 本身跨文件解析自定义属性也是短板，官方 issue 长期开着（<https://github.com/stylelint/stylelint/issues/6828>），要靠 `referenceFiles` 手工配。
- knip 的能力面是 JS/TS 的未用文件/导出/依赖，**不覆盖 CSS 自定义属性**——查不到它有这个规则。

### 结论 → **自研（在既有脚本上加反向，不新增依赖）**

理由是领域约束不是习惯：**判据必须能看见 `tailwind.config.ts` 与 `.tsx` className 这两个消费面**，而现成工具（stylelint 插件）的输入面只有 CSS 文件；如果为它接一整套 stylelint + 自定义 referenceFiles，最后仍要自己写「怎么从 Tailwind theme 里认出 `var()`」那一段——那一段正是全部工作量。`check-dangling-tokens.mjs` 已经把两个集合都算出来了，反向只是换个减法方向，且天然共用同一份扫描语义（避免两套扫描器漂成两种「什么算引用」）。豁免机制照抄 Spectrum 的 `@passthrough` 思路（明写注释才放行），不发明新语法。

---

## ⑤ 自媒体来源（TikHub）

完整附件：[`tikhub/tikhub-search.md`](tikhub/tikhub-search.md) / [`tikhub/tikhub-search.json`](tikhub/tikhub-search.json)
关键词「设计系统 token 间距 z-index 层级 动效 Tailwind」，抖音/小红书/B站/X 各 12 条共 48 条，2026-09-07 实抓（`scripts/research/tikhub-search.mjs`，key 只从 `TIKHUB_API_KEY` 读）。

有信号的三条（其余多是 Tailwind 安利、Figma 变量入门、AI 出图审美，与本轮四问无关）：

- **z-index 那两条是本报告 ③ 的直接依据**（见上，抖音 7652675982284934427 / 7650542081227771136 + B站 BV1f9jA6DEeN）。中文实践派与 Radix 官方规范**独立收敛到同一条分界**：局部序用 DOM order / `isolation`，全局浮层才用 token——这条一致性比任何单一出处都强。
- **Design Token 的公共心智里只有「颜色/字号/间距」三样**：「什么是Design Token｜用变量建立设计系统！」（[小红书 · 设计师凯文](https://www.xiaohongshu.com/explore/6699b7470000000025006951?xsec_token=YB5ihvjcQrV5MDf8F5ocLm0o1rKoqBEwUbZLYBoQZHlZk%3D&xsec_source=pc_search)，2024-07-19）、「把公司的Token规范（颜色/字号/间距）喂给AI」（[抖音 · AlunTalk](https://www.douyin.com/video/7648568425610054948)，2026-06-07）。⇒ **动效与 z-index 在公共认知里根本不算 token**——这恰好解释了我们方案 §0 那张表里「有 token 的三样满分、动效和 z-index 两样坏掉」的分布：不是我们疏忽，是这两层在整个中文实践圈都还没进 token 化的默认清单。这条支持把 C2/C3 做成门岗（靠人记得必漏）。
- **「间距全乱」是 AI 生成 UI 的典型症状**（同上 AlunTalk 条：Before「AI随便选的蓝色，间距全乱」/ After「精确到变量名」）。⇒ 间距门岗的价值主要在**未来的写入者**（含 AI 协作），不在存量 126 处的美观差异——这支持「棘轮照加」，也支持「不必为了上门岗而把 56 处半档值硬凑到栅格上」。
- **没查到的**：TikHub 48 条里**没有任何一条**讨论「duration/easing 该不该拆」或「定义了没人用的 token 怎么扫」。①④ 两问在自媒体层是空的，如实记账。

## 结论汇总

| 题目 | 判断 | 一句话理由 |
|---|---|---|
| ① 动效 token 分层 | **用已有** | Tailwind 两个 theme key / MD3 两组 token / DTCG composite 的三个独立子值——三家形状一致，我们原来的拼串打包在标准里没有对应物 |
| ② 间距接 theme.extend.spacing | **推翻前半条**；后半条自研补半档 | 8 个 token 与 Tailwind 默认栅格逐值相同（重复定义）；126 处里 70 处今天就能写、56 处是默认表没有的半档值 |
| ③ z-index 门岗 | **改形状**：阈值 20→50，且先补 CSS 变量 + `theme.extend.zIndex` 出口再上棘轮 | 162/197 是合法的局部序；框架默认 zIndex 只到 50，档位表是真缺口；不补出口的棘轮是给根因打补丁 |
| ④ 反向 token 检查 | **自研**（扩 `check-dangling-tokens.mjs`） | 唯一对口的现成工具只看 CSS 文件，看不见 `tailwind.config.ts` 与 `.tsx` className——而那正是我们的消费面 |

## 诚实记分

- 真跑了的：`grep`/`git grep` 的所有计数（126 / 197 / 34 / 162 / 5）都是本分支实扫；TikHub 48 条实抓有附件；npm registry 实读 `2.0.5`；`node_modules` 默认 theme 逐行实读。
- 只读没跑的：Radix Themes 的层叠上下文方案（读官方规范，没在本仓起 `<Theme>` 验证）；MD3 / DTCG（读规范，没做实现对照）；Spectrum stylelint 插件（读 README 与 registry 元数据，**没装没跑**——「它会把我们的 token 全报成 unused」是从它的判据推出的，不是实测）。
- 没覆盖到的：`transition-duration` 改前 `0s` / 改后 `0.14s` 的真机数字属于方案的验收门（A1），不在本报告范围；本报告只证明「打包必然失效」这条机制。
