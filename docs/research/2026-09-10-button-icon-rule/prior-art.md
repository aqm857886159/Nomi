# 按钮：文字还是图标 —— 一手规范摘录（先查别人）

> 状态：📎 已结案（结论已落进 `docs/design/nomi-design-system.md` §1.8）
> 日期：2026-09-10 · 用途：给 2026-09-10 用户拍板的六条按钮规则找一手佐证（R5：不凭记忆引用）

**为什么要这份**：用户拍板的规则我们照写就是了，但「≤4 字」「有公认图形才用 icon」「一屏一个主动作」
这三条如果只是我们说了算，下次有人想改就没有可对账的东西。下面每条都抓的是**一手规范原文**并附 URL。

---

## 摘录

### 1. Apple Human Interface Guidelines — Buttons
URL: https://developer.apple.com/design/human-interface-guidelines/buttons
（页面是 JS 渲染的壳，正文取自它自己的数据端点 `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/buttons.json`）

- > "In general, use a button that has a prominent visual style for the most likely action in a view."
- > "Keep the number of prominent buttons to one or two per view. Presenting too many prominent buttons increases cognitive load, requiring people to spend more time considering options before making a choice."
- > "Consider using text when a short label communicates more clearly than an icon."
- > "To use text, write a few words that succinctly describe what the button does."
- > "…consider starting the label with a verb to help convey the button's action…"

**支持**：规则 1（一屏一个主动作 · 认知负荷）、规则 2（文字比 icon 讲得清楚时就用文字）、规则 3（动词开头、几个字）。
这是唯一一份三条全中的来源。

### 2. Apple Human Interface Guidelines — Icons
URL: https://developer.apple.com/design/human-interface-guidelines/icons
（同上，正文取自 `.../icons.json`）

- > "Strive for a simple, universal design that most people will recognize quickly."
- > "In general, icons work best when they use familiar visual metaphors that are directly related to the actions they initiate…"

**支持**：规则 2 的前半句（icon 靠的是**公认**隐喻）。
**诚实边界**：这一页说的是「把 icon 设计得通用」，**没有**说「不通用时就退回文字」——那半句由上面 Buttons 页和 NN/g 承担，别把这条引超。

### 3. Material Design 3 — Buttons
URL: https://m3.material.io/components/buttons/guidelines
（Angular SPA，curl/WebFetch 只拿到壳；正文是在浏览器里渲染后读的 `<main>`）

- > "Since they have such strong emphasis, the filled style should be used sparingly, ideally for only one action on a page."
- > "Label text is the most important element of a button. It describes the action that will occur if someone taps a button. It should be very brief, ideally 1–3 words."
- > "Too many buttons on a screen can disrupt the visual hierarchy."

**支持**：规则 1（最高强调档一页只给一个动作）、规则 3（标签描述动作，1–3 词）。
注意它的 1–3 词比我们的「≤4 汉字」还紧一档，我们的门岗英文按 >2 词判红正落在这个区间里。

### 4. Material Design 3 — Icon buttons
URL: https://m3.material.io/components/icon-buttons/guidelines

- > "Icons visually communicate the button's action. Their meaning should be clear and unambiguous."
- > "These buttons should be used for common, easily understandable actions."
- > "On hover, the icon button displays a tooltip describing its action, rather than the name of the icon itself."

**支持**：规则 2（icon-only 的前提是这个动作**常见且无歧义**）+ 规则 1（hover 给的是**动作名**，不是图标名——正是我们说的「icon + hover 名字」）。

### 5. Nielsen Norman Group — Icon Usability
URL: https://www.nngroup.com/articles/icon-usability/

- > "Due to the absence of a standard usage for most icons, text labels are necessary to communicate the meaning and reduce ambiguity."
- > "To help overcome the ambiguity that almost all icons face, a text label must be present alongside an icon to clarify its meaning in that particular context."
- 小标题：`"Universal" Icons Are Rare`；另有 > "Don't rely on hover to reveal text labels…"

**支持**：规则 2 的最强版本 —— 「公认图形是少数」正是我们那条判据的原话来源。

### 6. Nielsen Norman Group — UI Copy: UX Guidelines for Command Names and Keyboard Shortcuts
URL: https://www.nngroup.com/articles/ui-copy/

- > "Labels for commands should be brief, informative, rely on verbs and adjectives, and avoid branded terms."
- > "Lead with verbs or verb phrases that clearly outline what will happen after the command is selected."
- > "Use just enough text to accurately describe the command and include no more than 2–4 words."
- > "Avoid using the generic phrase OK for button labels in confirmation dialogs."

**支持**：规则 3 全部三条（短 / 动词开头 / 不含糊），以及规则 4（别用泛化的「好的」——我们仓里对应的是「知道了」）。

---

## 一处真实分歧（不藏）

**NN/g 要求标签常驻可见，M3 接受 icon-only + hover tooltip。**
两家在「icon 旁边到底要不要一直挂着字」上不一致，规则 2 不是全票通过的。

**我们选 M3 那一侧，理由是领域约束不是偏好**：Nomi 是桌面创作工具，
画布 / 时间轴 / 节点工具条是**密度优先**的生产面（§1 设计原则），每颗工具按钮都挂常驻文字会把工具条撑到
放不下（时间轴那条工具条现在 15 颗控件分 3 簇）；而 NN/g 反对 hover 的主要理由是**触屏没有 hover**，
桌面 app 不吃这条。代价我们认：**这就是为什么规则 2 把「有没有公认图形」立成硬判据**——
省掉常驻文字的前提，是这个符号真的不用学。

## 这份摘录变成了什么

| 规则 | 落点 | 机器化 |
|---|---|---|
| 1 一屏一个主动作 · 主动作可带 ≤4 字文字 | 设计系统 §1.8.1 规则 1 | 标签长度 → `check:controls`；「一屏一个」是构图判断，样张阶段人眼 |
| 2 有公认图形才用 icon，自造概念不硬造 icon | §1.8.1 规则 2 | ❌ 人判（§6 盲测） |
| 3 动词开头 / ≤4 字 / 不带客服话术 / 同一动作一个词 | §1.8.1 规则 3 + `docs/GLOSSARY.md`「动作词」表 | ✅ `check:controls` 规则四~六 |
| 4 否定动作统一成 × 或统一次按钮 | §1.8.1 规则 4 | ✅ 禁用词表拦「不要 / 不用 / 算了」 |
| 5 一个 icon 一个含义，新 icon 先查词典 | §1.8.1 规则 5 + §6 语义图标登记 | ✅ `check:icon-semantics` 词典登记 |
