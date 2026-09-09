# 减法设计流程：补上七闸里「新面」那一半 + 图标语义门岗

日期：2026-09-07 · 基线：`origin/main@4f55e2a36`
起因：用户 2026-09-07 原话——「每次做设计样张的时候我发现，设计的老让用户很难用、不简洁、不简单，有很多冗余，包括排版设计、功能冗余、按钮繁杂、icon 和用户心智不一致」
状态：✅ 已落地（三项用户拍板：默认 v1 / 进 hook 闸① / icon 门岗现在做）

---

## 1. 诊断：不是没有流程，是流程有两个洞

**先纠一个我自己的初判**：第一轮我以为「我们没有防止界面变复杂的机制」。**查完发现错了**——我们有一套完整的**七闸页面设计流程**（`docs/design/page-design-process.md`），有 howto，有工具链（`check:mockup-contracts` / `check:design-lab` / `inject-mockup-tokens`），hook 里还有设计关键词检测。

那为什么界面还是越长越杂？查出来是**两个具体的洞**，都是机械问题，不是态度问题：

### 洞 1 · 执行流程的那个技能是幽灵

`scripts/claude-hooks/self-check.sh` 每次命中设计关键词都顶出一行「这类活走 `nomi-design-flow` 技能」，`docs/README.md` 也把它列为真相源，`nomi-design-flow-howto.md` 开头写着「指向 `.claude/skills/nomi-design-flow/SKILL.md`」。

**但那个文件从来不存在**（本 worktree 和主仓都查过）。`.claude/*` 整体 gitignore，nomi-* 技能是本机数据、没有仓内真相源 → 换机或清理就没了，而且没有任何门岗会发现。

后果：**设计流程只在「我恰好去翻文档」时才跑**。hook 说了有技能，技能会自己加载——所以我不会去翻文档。防线指向一个不存在的东西 = 防线是断的（R28）。

### 洞 2 · 闸②（判层级）只覆盖「现有面」

闸② 是这套流程里最值钱的一节。但它的判定问题（「用户在这个面上，10 次里有几次会用它」）和产出物（**before → after 表**），前提都是**这个面已经存在**——有既有常驻条可以对照预算，有 before 可以填。

**画一个全新面板时没有 before，整节自动失效。** 而新功能恰恰全是新面。

于是新面的设计退化成**功能列 → 控件列的 1:1 直译**：拿到 5 个 API 端点就长出 5 个区，因为没有任何一步逼我先回答「用户这一刻只想做完哪一件事」。D1（outside-in）写在 CLAUDE.md 里，但**流程上没有一步强制它**。

### 旁证：事后体检也不可靠

`docs/audit/redundancy-backlog.md` 里 B7 标着「【第 2 轮·**用户点名**】模型选择弹窗零信息架构」——**审计第 1 轮没扫出来，是用户自己撞上的。** 所以不能靠「事后再扫一遍」补救，得在画的那一刻就有约束。

## 先查别人

完整报告：[`docs/research/2026-09-07-subtractive-design/prior-art.md`](../research/2026-09-07-subtractive-design/prior-art.md)（含 TikHub 自媒体检索产物）

**① 依赖里已有？** ❌ 没有。
- `ls node_modules | grep eslint-plugin` → 只有 `eslint-plugin-react-hooks`、`eslint-plugin-react-refresh`，**无任何设计系统 / 图标一致性 lint**。

**② 仓库里已有？** ✅ 有，而且**这一问翻转了整个方案**。
- 七闸页面设计流程：`docs/design/page-design-process.md:12-38`（全景 + 每闸防的真实事故）
- 控件层级 L1/L2/L3/L4 + 三条硬规则：`docs/design/nomi-design-system.md:101-152`
- 样张工具链：`package.json:157`（`check:mockup-contracts`）、`scripts/inject-mockup-tokens.mjs`、`scripts/check-design-lab.mjs`
- 事后 UX 体检（8 类固定尺子 + 四档分诊）：`.claude/skills/nomi-ux-audit/SKILL.md`
- hook 设计关键词检测：`scripts/claude-hooks/self-check.sh:50-55`
- ❌ **但执行体不存在**：hook、`docs/README.md:17`、`docs/design/nomi-design-flow-howto.md:3` 三处都指向 `.claude/skills/nomi-design-flow/SKILL.md`，**该文件从未存在**（worktree 与主仓都查过）
- ⚠️ 已有的 `check:icons` 是 `scripts/check-app-icons.cjs`（`package.json:44`）——查**应用图标 .icns/.png**，与界面图标语义无关
- ⚠️ §6「语义图标登记」表存在但只有 3 行、无门岗：`docs/design/nomi-design-system.md:820`

→ 方案因此从「新建一套流程」改为「**补两个洞 + 建出那个幽灵技能**」，避免造并行版（P1）。

**③ 生态里已有？** 🟡 只覆盖「形制」，不覆盖「跨文件语义漂移」。
- Atlassian `@atlaskit/eslint-plugin-design-system` · `icon-label`：<https://atlassian.design/components/eslint-plugin-design-system/icon-label/> — 管图标有没有可访问标签
- Atlassian 同插件 · `no-custom-icons`：<https://atlassian.design/components/eslint-plugin-design-system/no-custom-icons/> — 管图标是否来自设计系统那一套（= 我们 §6 已在做的形制约束）
- Pinterest Gestalt eslint plugin：<https://gestalt.pinterest.systems/get_started/developers/eslint_plugin> — 组件级 icon 取值约束，最接近但仍是单组件内
- 设计 token lint 通用做法：<https://backlight.dev/blog/best-practices-w-eslint-part-1> — 我们已有 `check:tokens`

→ **没有找到任何现成规则做「同一动作 → 同一图标」的跨文件比对**（⚠️ 这是"没找到"，不是"证明不存在"）。

**④ TikHub 自媒体里怎么说？** 供给的几乎全是「要做减法」的**态度**，极少「怎么强制自己做减法」的**机制**。
- 唯一有机制含量的一条：「复杂界面真正怕的，不是信息多，而是所有内容都挤在第一层」 <https://www.douyin.com/video/7680372656201272616> — **独立印证我们 §1.5.3「杂的主因是没秩序，不是数量」**
- 「好的家懂得做减法，摒弃冗余设计」 <https://www.douyin.com/video/7674195589692656923> — 泛化口号，无可操作机制
- 「笨人追逐复杂，聪明人砍掉冗余」 <https://www.bilibili.com/video/BV1G3td6nEC8> — 同上

→ 反过来支持本方案的落点：**缺的不是「知道要简洁」，是「流程里有一步逼你减」**。

**结论**：设计流程那半 **用已有 + 补洞**；`check:icon-semantics` 那半 **自研**——生态只覆盖形制，且**跨文件不变量不适合 ESLint 逐文件的规则模型**（领域约束，非偏好），沿用本仓既有跨文件门岗形态（同 `check:vocabularies` / `check:i18n`）。

## 2. 已落地的四件事

| # | 做了什么 | 落点 | 补的是哪个洞 |
|---|---|---|---|
| 1 | **建出 `nomi-design-flow` 技能** | `.claude/skills/nomi-design-flow/SKILL.md` | 洞 1 |
| 2 | **闸② 补「新面」那一半：三件产物** | `docs/design/page-design-process.md` §2.5（真相源）+ `nomi-design-system.md` §1.5.5（索引） | 洞 2 |
| 3 | **三件产物进 hook 闸①** | `scripts/claude-hooks/self-check.sh` | 洞 2 的 salience |
| 4 | **图标语义门岗** | `scripts/check-icon-semantics.mjs` + `.node-test.mjs` + baseline，挂进 `gates:contracts` | 用户点名的 icon 问题 |

### 三件产物（新面必出，缺一件 = 样张不完整、不进拍板）

1. **任务卡**（开画前一行字）：「<谁> 在 <什么时刻>，做完 <哪一件事> 就走。」
   ← 这行就是这张样张的验收标准，**替代新面缺失的 before**。一张卡只描述一个时刻。
2. **三版减法梯度**（不是风格梯度）：**v1 只有一件事**（刻意「少得让人不安」）／ v2 +1 ／ v3 全都要。**默认推荐 v1**。
   > **底层逻辑**：把举证责任翻过来——从「想删的人得说服我为什么删得掉」变成「想加的人得说服我为什么非加不可」。同一个人、同一张图、同一个判断力，只换了默认值，结果完全不同。
   > **为什么非这样**：人对着满图做不了减法，图上每个按钮都有它的理由（它们是从功能列直译来的，当然都有理由）。
   > **代价（明说）**：v1 第一眼常让人觉得「功能太少」，需要多几轮加回来——加回来的那几个是被论证过的，一开始就在图上的那些没有。
3. **删除清单**：`我没放上去的 / 为什么 / 用户要它时怎么找到`。
   ← 样张只展示「放了什么」，看不见「没放什么」→「该不该放」这个决策根本不可见，没人能审。**这张表就是减法压力的载体。**

### 图标门岗 `check:icon-semantics`

**判据**：「动作」= i18n key（`aria-label={t('assetLibrary.pasteLink.button')}` 里那个 key），「图标」= 该**控件**子树里渲染的 Tabler 组件。同一 key 被配 ≥2 个不同图标 = 红。

**三条刻意的排除**（每条都是实测出来的假红，有夹具测试锁住）：
- 容器 `<div role="dialog" aria-label onClick={stopPropagation}>` 不算动作身份 —— 否则弹层里所有图标都被算成同一动作的多个图标（实测 `TimelineTransitionPicker` 因此假红）
- 同一三元里的两个图标 = 状态切换（`busy ? IconLoader2 : IconDownload`），不是漂移
- Chevron / Caret / Selector / Loader 是结构示能，不参与语义比对

**收敛过程**（诚实记录）：初版扫出 42 个冲突，逐个读代码后发现绝大多数是上面三类假红；修完根因剩 **3 个真冲突**，全部人工核对过代码确认是真漂移。

**存量 3 条**（进基线，棘轮只减不增）：
| 动作 | 两个图标 | 现场 |
|---|---|---|
| `scene3d.character.exitCameraControl` | IconVideo / IconX | `scene3dCharacterActionBar.tsx:50` vs `:327` |
| `scene3d.character.exitControl` | IconManFilled / IconX | 同文件 `:60` vs `:259` |
| `scene3d.fullscreen.openEditor` | IconCube / IconMaximize | `Scene3DEditor.tsx:376` vs `:412` |

三条都是「同一动作两个入口配了不同图标」，**改法要先看真实 3D 工具栏再定**（可能该改的是 i18n key 而不是图标——line 50 那颗是"当前处于相机控制（点击退出）"的状态钮，line 327 是纯退出钮，复用同一个 key 本身就可疑）。

**R17 已验**：造一个新冲突 → 门岗 exit 1 并指名文件行号；还原 → 绿。夹具测试 5 条全过（1 条证会红、3 条证不乱红、1 条证排除不过度）。

**它查不到、只能靠人的（明说，别当它查了）**：图标隐喻对不对（`IconTrash` 拿来表示"归档"这种）——那是**盲测**：遮住旁边的文字，说得出它是干嘛的吗？说不出 → 配文字标签或换图标。

## 3. 遗留 / 下一步

- **`.claude/skills/` 是 gitignore 的本机数据**，nomi-* 技能没有仓内真相源——这正是洞 1 的成因（技能会随机器丢失且无人发现）。要不要像 hooks 那样立 `scripts/claude-skills/` 真相源 + postinstall 安装 + `check:claude-skills` 同步门岗？**建议做，但另起一件**，本次不夹带。
- 图标存量 3 条待清（需先看真实 3D 工具栏）。
- 第一个跑这套新流程的案例：TikHub「找参考」，见 `docs/research/2026-09-07-tiktok-creative-intelligence.md` §4 与后续设计文档。
