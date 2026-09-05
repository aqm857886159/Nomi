# Tailwind 只扫 `.tsx` 时，住进 `.ts` 的类名会静默消失

> 📎 教训 · 首次记录 2026-09-06 · 状态：✅ 已固化（由 `scripts/build-tailwind.test.ts` 接管）
> **触发场景**：把一个拼 className 的纯函数/常量从组件里搬进 `.ts`；界面某处「样式没生效」但类名明明写着、类型检查全绿、控制台干净；给 `.ts` 里的样式常量加了新类却看不出变化。

**结论**：`tailwind.config.ts` 的 `content` 必须同时列 `./src/**/*.tsx` **和** `./src/**/*.ts`。
只列 `.tsx` 时，类名字符串一旦住在 `.ts` 里就不再被生成——**不报错、不警告、类型检查全绿**，
只是那几条 CSS 不存在，元素静默掉回默认排版。

## 为什么会踩

类名住在哪个后缀里，是 **R9 分层**的结果：纯换算函数（不订阅、不持有状态）该从组件壳里搬出去，
搬出去就落进 `.ts`。这和「这段样式要不要生成」毫无关系。可 `content` 只列 `.tsx` 时，
这两件互不相干的事被绑死了：**分层做对，样式就坏掉**。

而且坏得完全没有信号——Tailwind 对「没扫到的类」和「不存在的类」一视同仁：不生成，不出声。

发现路径：2026-09-06 把 `residentItemClassName` 从 `ProjectAgentResidentShell.tsx` 抽到
`resident/residentShellDisplay.ts`（PR #517），用户气泡的 `ml-auto` / `max-w-[86%]` 当场消失，
气泡从右侧小卡片变成整行通栏。当时的处置是把函数搬回 `.tsx` 并留注释「不能搬」——
那是**把防线建在人的记忆上**，且和 R9/R12 的分层要求正面打架。

**同一天的全仓盘点证明这不是孤例**：`content` 加上 `./src/**/*.ts` 后重建，
新增 16 个 utility、**零删除**（minify 后 157 849 B → 159 740 B，+1 891 B），其中 4 处是一直静默失效的真实样式。
更刺眼的是，仓库自己的 `check:dangling-tailwind` 门岗**早就**扫 `.ts|.tsx|.css`
（`scripts/check-dangling-tailwind.mjs:140`）——它一直把 `.ts` 当作类名的合法住址来校验 token 键，
只有构建不这么认为。门岗和构建对「类名住在哪」的口径分了岔，岔了多久没人知道。

## 盘点：4 处一直是死的（真实 CSS 前后测量，见「出处」）

| 处 | 文件 | 死掉的类 | 之前真实表现 |
|---|---|---|---|
| A | `src/ui/browser/popover/browserAssetPopoverConstants.ts` | `right-5` `-top-2` `-bottom-2` `-left-2` `-right-2` | 浮窗**八个 resize 手柄全废**：上/下边手柄 `right` 缺失 → 空 div 宽度 0，**完全没有热区**；左/右/四角手柄偏移缺失 → 全都塌回静态流位置，堆在左上角 |
| B | `src/workbench/generationCanvas/components/groupVisualContract.ts` | `bg-nomi-paper/[0.32]` `border-nomi-ink-60` | 画布分组框**没有半透明底**（全透明）；拖放目标描边掉回 Tailwind 默认灰 `rgb(229,231,235)`，不是设计色 |
| C | `src/workbench/generationCanvas/nodes/nodeComposerStyles.ts` | `disabled:bg-nomi-ink-20` | 生成钮禁用态底色仍是满深 `ink`，和可点状态一模一样（只有文字变浅），看着像「能点」 |
| D | `src/workbench/preview/previewControlTokens.ts` | `disabled:hover:text-[var(--workbench-muted)]` `enabled:hover:text-…` `enabled:cursor-pointer` | 预览控制条**禁用按钮 hover 仍高亮成 `ink`**——该文件顶部那段长注释详细解释了怎么用双伪类压过 twMerge 的隐藏覆盖，**而这个修复从来没生效过** |

D 尤其值得记：注释写得越细致，越容易让人相信它做到了。**注释描述的是意图，不是既成事实。**
（`enabled:cursor-pointer` 那条是无害的——Tailwind preflight 本来就给 `button` 发 `cursor: pointer`。诚实归诚实。）

新增的 16 个 utility 里另有约 11 条是提取器噪音（`.invert` 来自 `Matrix4().invert()`、`.ordinal` 来自局部变量、
`.[nomi:start]` 来自日志前缀、`.!grid` 来自 `if (!grid)`）。它们生成的是无人引用的惰性规则或浏览器直接丢弃的
无效声明，共约几百字节。**不值得为它加 safelist / 排除去糊**——那是拿一个新的配置分叉去治一点点字节。

## 为什么修在构建层，而不是加个门岗（R28）

| | 方案 1 · `content` 加 `./src/**/*.ts`（已采纳） | 方案 2 · 门岗禁止 `.ts` 里出现类名 |
|---|---|---|
| 防线在哪 | 构建本身。扫描面覆盖真实的类名来源 | 门岗 + 人的记忆 |
| 和 R9/R12 的关系 | 无冲突。纯函数爱住哪住哪 | **正面冲突**：把带类名的纯函数钉死在组件壳里，壳只会越撑越大 |
| 漏网可能 | 无。类名在哪个后缀里都被扫到 | 有。门岗只认静态字面量，拼接/间接引用照样漏 |
| 代价 | +1 891 B（含约几百字节提取器噪音） | 每次分层重构都要绕开它 |

R28 口径：**能让构建拦住的，别留给门岗；能让门岗拦住的，别留给人。**
这个坑的最早可拦层就是构建自己——扫描面对了，门岗和人都不必参与。
留下的那条测试（`scripts/build-tailwind.test.ts`）不是新门岗，它只守住「扫描面别再退回去」。

## 怎么用

- 改 `tailwind.config.ts` 的 `content` 时，`.ts` 与 `.tsx` 的排除项要**一一对齐**（test / spec / d.ts / vendor）。少一半就是给同一个坑留了半扇门。
- 报告「某处样式没生效」之前，先确认那个类**真的在生成的 CSS 里**：
  `node scripts/build-tailwind.mjs && grep -F '.你的类名' .tmp/tailwind.generated.css`。类不在 CSS 里 ≠ 类名写错了。
- 新增哨兵测试用的类必须**只在 `.ts` 里出现**。一旦它也进了某个 `.tsx`，测试会靠 `.tsx` 那条通过，从此永远绿——
  `build-tailwind.test.ts` 里的 vacuity 守卫就是为此存在的（同类前科见 [`vacuous-probe-passes-forever.md`](vacuous-probe-passes-forever.md)）。
- 用 headless 浏览器量 hover / 主题相关的计算色时，**先等 transition 结束**再读，否则读到的是插值帧
  （同 [`walkthrough-computed-color-asserts.md`](walkthrough-computed-color-asserts.md)）。本次量 D 处就先踩了一次。

## 出处

- 分支 `fix/tailwind-content-scan-ts-20260906`；改动：`tailwind.config.ts` 的 `content` + `scripts/build-tailwind.test.ts`。
- R17 红证：把 `content` 改回只扫 `.tsx` → 该测试红（`.right-5` / `.bg-nomi-paper\/\[0\.32\]` 不在 CSS 里）；改回来 → 绿。
- 盘点方法：`node scripts/build-tailwind.mjs` 前后各存一份 `.tmp/tailwind.generated.css`，`comm` 比选择器集合（零删除、16 新增），再把新增类逐条 `grep` 回 `.ts` 源。
- 4 处表现用 headless Chromium 加载**真实的前/后 CSS**、挂**源码里原样的类串**测 `getBoundingClientRect` 与计算色得到，不是推理。
- 现场首次暴露：PR #517（`residentItemClassName` 搬家 → 用户气泡 `ml-auto` / `max-w-[86%]` 消失）。
  #517 合入后已在本分支收尾：两处「不能搬」的注释改成新结论，`residentItemClassName` 搬回
  `resident/residentShellDisplay.ts`，并把 `max-w-[86%]` 收进哨兵——现在它在全仓 `.tsx` 里零出现，
  而 `.max-w-\[86\%\] { max-width: 86% }` 确实在生成的 CSS 里。整条链路真通了。
- `check:design-lab` 46 格视觉基线全绿、零格变化——4 处都不在 Agent 面板里，符合预期。
