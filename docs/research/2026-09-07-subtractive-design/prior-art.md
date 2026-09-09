# 先查别人：减法设计流程 + 图标语义门岗

日期：2026-09-07 · 服务对象：`docs/plan/2026-09-07-subtractive-design-process.md`
性质：R27 要求的可复核检索报告。**结论先行：流程那半"用已有"（补洞不新建），门岗那半"自研"（生态只覆盖形制，不覆盖跨文件语义漂移）。**

---

## 问题 1 · 依赖里已有？

| 查了什么 | 结果 |
|---|---|
| `ls node_modules \| grep eslint-plugin` | 只有 `eslint-plugin-react-hooks`、`eslint-plugin-react-refresh`。**没有任何设计系统/图标一致性 lint** |
| 仓内 eslint 配置 | 无 UI 一致性相关规则 |

→ 依赖里没有现成能力。

## 问题 2 · 仓库里已有？（**这一问改变了整个方案**）

| 查了什么 | 结果 | file:line |
|---|---|---|
| 有没有页面设计流程 | ✅ **有，而且很完整**——七闸流水线 + 每闸防的真实事故 + 可搬运模板 | `docs/design/page-design-process.md`（全文） |
| 有没有控件层级规则 | ✅ 有 L1/L2/L3/L4 判定 + 三条硬规则 + 手法优先级 | `docs/design/nomi-design-system.md:101-152` |
| 有没有样张工具链 | ✅ 有 `check:mockup-contracts` / `check:design-lab` / `inject-mockup-tokens` / `extract-design-spec` | `package.json:157` 等 |
| 有没有事后体检 | ✅ 有 `nomi-ux-audit` 技能（8 类固定尺子 + 四档分诊 + 活 backlog） | `.claude/skills/nomi-ux-audit/SKILL.md` |
| 有没有 hook 提示 | ✅ 有设计关键词检测 | `scripts/claude-hooks/self-check.sh:50-55` |
| **执行流程的技能在不在** | ❌ **不在**。hook / `docs/README.md:17` / howto 三处都指向 `.claude/skills/nomi-design-flow/SKILL.md`，**该文件从未存在**（worktree 与主仓都查过） | — |
| 有没有图标门岗 | ⚠️ 有 `check:icons`，但它是 `check-app-icons.cjs`——查**应用图标**（.icns/.png），**与界面图标语义无关** | `package.json:44` |
| §6 语义图标登记表 | ⚠️ 存在但只有 **3 行**，无门岗 | `nomi-design-system.md:820` |

→ **结论翻转**：原以为"没有防止界面变复杂的机制"，实为"机制齐全但有两个洞"（执行体缺失 + 闸②不覆盖新面）。
方案因此从「新建一套流程」改为「**补洞 + 建出那个幽灵技能**」——避免了造并行版（P1）。

## 问题 3 · 生态里已有？

| 别人的做法 | 出处 | 它覆盖什么 | 对我们够不够 |
|---|---|---|---|
| **Atlassian** `@atlaskit/eslint-plugin-design-system` · `icon-label` 规则 | <https://atlassian.design/components/eslint-plugin-design-system/icon-label/> | 图标要有可访问标签 | ❌ 只管**有没有标签**，不管同一动作是否漂成两个图标 |
| **Atlassian** 同插件 · `no-custom-icons` / `no-legacy-icons` | <https://atlassian.design/components/eslint-plugin-design-system/no-custom-icons/> | 图标必须来自设计系统的那一套 | ❌ 这正是我们 §6「唯一图标库 `@tabler/icons-react`」已经在做的**形制**约束 |
| **Pinterest Gestalt** eslint plugin | <https://gestalt.pinterest.systems/get_started/developers/eslint_plugin> | 特定组件上必须用特定 icon 值；禁某类 icon 用在某组件 | 🟡 最接近，但仍是**单组件内**的取值约束 |
| 设计 token lint 的通用做法 | <https://backlight.dev/blog/best-practices-w-eslint-part-1> | 防硬编码值、强制用 token | ✅ 我们已有 `check:tokens` 在做 |

**判断（R20 三问）**：
1. **通用问题吗**？图标一致性是通用的——**但生态覆盖的是「形制」（哪个库 / 有没有标签），我们缺的是「跨文件语义漂移」（同一动作在 A 文件用 IconVideo、B 文件用 IconX）**。这两件不是一件事。
2. **同类产品怎么做**？上表。**我没有找到任何一个现成规则做「同一动作 → 同一图标」的跨文件比对**；⚠️ 诚实标注：这是"没找到"，不是"证明不存在"。
3. **在护城河上吗**？不在——所以本来应该买不应该造。**但没有可买的**，且自研成本极小（约 200 行 + 5 条夹具测试）。

**为什么写成独立脚本而不是 ESLint 规则**（这是**领域约束**不是偏好）：
本检查的判据是**跨文件**的——同一个 i18n key 出现在 `A.tsx` 与 `B.tsx` 时才构成冲突。ESLint 规则默认**逐文件**执行、看不到全仓聚合状态，跨文件不变量不适合 ESLint 的规则模型。
本仓所有跨文件门岗（`check:vocabularies` / `check:i18n` / `check:boundaries`）都是同一形态的独立脚本 + 棘轮基线——**沿用既有形态，不新起一套**。

## 问题 4 · TikHub 自媒体里怎么说？

抓取命令（可重跑）：

```bash
node scripts/research/tikhub-search.mjs \
  --q "界面 太复杂 做减法 设计 冗余 按钮太多" --platform douyin,bilibili --limit 6 \
  --out docs/research/2026-09-07-subtractive-design/tikhub/
```

产物：`docs/research/2026-09-07-subtractive-design/tikhub/tikhub-search.{json,md}`（抖音 6 + B站 6）

| 平台 | 出处 | 摘要（原文，未改写） | 这条证明了什么 |
|---|---|---|---|
| 抖音 | <https://www.douyin.com/video/7680372656201272616> | 「为什么复杂科技界面，信息很多却依然不拥挤？**复杂界面真正怕的，不是信息多，而是所有内容都挤在第一层。**」 | ✅ **独立印证我们 §1.5.3 的核心判断**——「杂的主因是没秩序，不是数量」，以及 L1/L2/L3/L4 分层的必要性 |
| 抖音 | <https://www.douyin.com/video/7674195589692656923> | 「好的家懂得做减法，摒弃冗余设计，在极简框架下…」 | 🟡 泛化的减法口号，无可操作机制 |
| B站 | <https://www.bilibili.com/video/BV1G3td6nEC8> | 「笨人追逐复杂，聪明人砍掉冗余」 | 🟡 同上 |

**读到的真实摩擦**：自媒体层供给的几乎全是**「要做减法」的态度**，极少有**「怎么强制自己做减法」的机制**。唯一有机制含量的是「别把所有内容挤在第一层」那条——它讲的是分层，正是我们已有的 §1.5。
→ 这反过来支持本方案的落点选择：**缺的不是"知道要简洁"，是"流程里有一步逼你减"**。

## 结论

| 部分 | 用已有 / 自研 | 理由 |
|---|---|---|
| 设计流程 | ✅ **用已有**（`page-design-process.md` 七闸）+ 补两个洞 | 已有的很完整；新建 = 并行版（P1） |
| 「新面三件产物」 | 🔨 自研（作为闸②的一节） | 生态与仓内都没有覆盖「新面没有 before」这一空缺 |
| 图标形制约束 | ✅ **用已有**（§6 唯一库 + size/stroke 表） | 与 Atlassian `no-custom-icons` 同思路，已在做 |
| 图标**语义漂移**门岗 | 🔨 自研 `check:icon-semantics` | 生态只覆盖形制；跨文件不变量不适合 ESLint 规则模型；沿用本仓既有跨文件门岗形态 |
