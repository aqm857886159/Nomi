# 方案：把「导进来的技能」一路接到 Agent 里能真用上（2026-09-07）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

- 状态：实施中（分支 `fix/skill-import-real-use-20260907`，PR #582）
- 「先查别人」报告：[`docs/research/2026-09-07-skill-import-real-use/prior-art.md`](../research/2026-09-07-skill-import-real-use/prior-art.md)

## 摩擦（真机实拍，不是推测）

「群里有人发我一个技能，我要在 Nomi 里用上它」这条闭环，今天在三处断掉：

1. **导进来了却用不上。** 技能库面板里刚导入的卡片好好地立着，同一屏右边 Agent composer 的 `/` 技能菜单里**一个字都没有它**——用户只能靠重启 App 撞见。五门全绿、单测全绿、既有 `skill-import-formats.walk.mjs` 也全绿，因为没有任何一条走查跨过「写入面板」与「使用面板」这条缝。
2. **拖进来什么都不会发生。** 群里发来的是一个 zip，用户第一反应是拖进面板——主进程的 `will-navigate` 守卫把默认导航挡了，于是连报错都没有，**静默**。导入只有一条路：点「导入文件」→ 系统对话框。
3. **技能文件夹根本选不中。** pi / bigpowers 生态里技能是**一个文件夹**（`audit-code/SKILL.md`），系统对话框的 `accept` 选不中文件夹，用户得先自己压成 zip。

## 先查别人

> 全文与出处清单见 [`prior-art.md`](../research/2026-09-07-skill-import-real-use/prior-art.md)；下面是抄回方案的结论。

- **依赖里已有？** zip 解包用现成的 `fflate`（[`parseSkillImport.ts:11`](../../src/workbench/skillLibrary/parseSkillImport.ts:11)、[`:115`](../../src/workbench/skillLibrary/parseSkillImport.ts:115)），本轮零新增解压实现；目录拖拽是**平台原生能力**不是库能力（`node_modules/typescript/lib/lib.dom.d.ts:9541` 的 `webkitGetAsEntry` 与 `:11859` 的 `readEntries`）；`ls node_modules | grep -Ei "dropzone|file-selector"` 为空——react-dropzone 一族不是本仓依赖，**不为这十来行新增依赖**（R20 第 ③ 问：不在护城河上，也不碰钱不碰信任，标准实现替不掉「归一成 `{dirName, files}`」那一层）。
- **仓库里已有？** 「共享状态缺失效信号」这一族**本仓已有正解在跑**：模型目录的 `nomi-model-catalog-changed`，写方派发（[`useOnboardingDrawerCatalog.ts:112`](../../src/ui/onboarding/useOnboardingDrawerCatalog.ts:112)）、读方各自订阅（[`useAgentPanelV4Data.ts:210`](../../src/workbench/ai/v4/useAgentPanelV4Data.ts:210)、[`useVendorHealth.ts:73`](../../src/ui/onboarding/useVendorHealth.ts:73)）。技能库缺的就是它的对应物 ⇒ **照抄，不发明第二套范式**。安全校验同理，主进程那份是唯一真相源（[`electron/skills/skillPackage.ts:29`](../../electron/skills/skillPackage.ts:29)、[`:59`](../../electron/skills/skillPackage.ts:59)），渲染层深度上限**对齐**它。
- **生态里已有？** 格式权威已经收敛且**不在我们手上**：Agent Skills 规范的必填面只有 frontmatter 的 `name` + `description`（[规范总览](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)），pi / Claude Code / Codex 三家同格式，Nomi 是唯一多一份 `skill.json` 的人（逐项对照 [`2026-09-07-pi-package-ecosystem.md:168`](../research/2026-09-07-pi-package-ecosystem.md:168)）。`readEntries` 必须循环读到空是文档化行为（[MDN](https://developer.mozilla.org/docs/Web/API/FileSystemDirectoryReader/readEntries)），只读一次会静默丢文件。
- **同类产品？** Skills Hub 做的是「装一次、同步到多个 CLI」（[x.com/TiedGST](https://x.com/TiedGST/status/2094309544713453755)，2026-08-31）——问题形状不同，**生态里没有现成的东西能替我们做这件事**。
- **TikHub 自媒体怎么说？** 48 条实抓（[附件](../research/2026-09-07-skill-import-real-use/tikhub/tikhub-search.md)）里，技能一律是「群里转发 → 装上就用」的东西（[小红书「Hermes必装skillTOP10」](https://www.xiaohongshu.com/explore/6a4e594700000000150276aa?xsec_token=YBZhA9RHKtpEiKUe8cohlxtRDhZ1lKtrkgPlXZ-ZxCWfk%3D&xsec_source=pc_search)），用户心智里技能 = 一个 `SKILL.md`（[抖音「说说 Skills 的 SKILL.md 文件结构」](https://www.douyin.com/video/7674851329126732651)），**48 条里没有一条提到 `skill.json`**；而且用户会一路追到「到底有没有被加载」（[小红书「你装的skill是如何被识别加载的」](https://www.xiaohongshu.com/explore/6a30068a0000000006023fef?xsec_token=YBkl5ngX373QEsP9tLqH9FPaLjVo8SqsbdME8p9b7oSW0%3D&xsec_source=pc_search)）。
- **本仓历史？** 上一轮修的是「进不进得来」（[`2026-09-01-skill-import-standard-formats.root-cause.json`](../fixes/2026-09-01-skill-import-standard-formats.root-cause.json)、[`2026-08-27-skills-knowledge-distribution.md`](2026-08-27-skills-knowledge-distribution.md)），**本轮的 delta 是「进来之后用不用得上」**；教训已落 [`docs/lessons/imported-thing-invisible-to-the-second-reader.md`](../lessons/imported-thing-invisible-to-the-second-reader.md)。

## 根因与修法

**① 盘上状态有第二个读者，写方却不派失效信号。** 两个读者各自 `listWorkbenchSkills()` 一次就不再管：`useWorkbenchSkills.ts` 导入后只 `reload()` 自己那份 React state；`useAgentPanelV4Data.ts` 在 `useEffect(..., [])` 里读一次，此后永不重读。修在**写方**——补 `skillLibraryChanged.ts` 失效信号，所有读者订阅它重读。

**② 拖拽 = 加速器不是新入口**（设计系统 §1.5.2）。新增 `skillDropIntake.ts` 只做**输入形状归一**（DataTransfer → 一个或多个 `{dirName, files}`），格式解析仍复用 `parseSkillImport.ts`，真正的安全校验仍在主进程——渲染层判断一律不可信。不新增按钮，只让已有面板认得「松手」。目录遍历要点：reader 必须反复读到空为止；深度上限与 `SKILL_PATH_MAX_DEPTH` 同口径。一次拖多个各自成败、各自给回执。

**③ 失败回执不能把用户指向一个不存在的格式。** 旧文案写「把它和 `skill.json` 放在同一层，再导一次」——错的。改成：

> 导入失败：这个包里没有 SKILL.md。技能正文必须放在 SKILL.md 里（和 Claude Code、pi 一样的格式），把它放在包的顶层再导一次。

en 同步；走查断言钉到新文案（旧串已不存在，留着就是一条死选择器）。

> **与 [#580](https://github.com/aqm857886159/Nomi/pull/580) 的分工**：解析层的 `skill.json` 彻底删除归那条收敛分支，本方案**只动文案与走查断言**。

## 不动项

- 不动主进程的安全边界（可执行区跳过、路径深度、manifest 校验）。
- 不删 `skill.json` 的解析路径（归 #580）。
- 不新增导入按钮、不新增依赖。

## 验收门

- `tests/ux/skill-import-real-use.walk.mjs`：三种真实输入走完整闭环（导入 → 面板 → Agent 技能菜单 → chip → **模型报文里真的有那份正文**），零额度。
- **证伪性**：去掉 `onSkillLibraryChanged` 订阅即当场报红（已实测）。
- `03-legacy-manifest-rejected.png` 全屏逐字确认**不出现 `skill.json`**。
- `pnpm run gates` 全绿。

## 回滚

三个改动各自独立，回滚粒度 = 单文件：撤 `skillLibraryChanged.ts` 的两处订阅即回到「重启才可见」；撤 `skillDropIntake.ts` 的挂载即回到「只能点导入文件」；文案改回属纯 i18n 回退。
