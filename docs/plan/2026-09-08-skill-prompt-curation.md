# 技能与提示词即时价值一期

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施中；UI 与封面锚图待拍板。

## 用户摩擦与范围
用户不应重新学习提示词语法。首期收录 15 个创作技能、至少 40 个节点效果，保留来源、许可证、适用节点、分组、槽位和可复用媒体。四笔里程碑提交：候选证据、内容与读取器、封面脚本与三张锚图、两张真实布局 HTML 样张。

## 先查别人
- Agent Skills 官方标准：https://agentskills.io/specification 。采用目录 + SKILL.md，顶层 name/description/license，扩展仅 metadata.nomi；不另建 skill.json。现有官方夹具：[SKILL.md](../../tests/fixtures/standard-formats/agent-skill/SKILL.md)。
- 已有格式与导入实现：[skillFrontmatter.ts](../../electron/skills/skillFrontmatter.ts)、[skillPackage.ts](../../electron/skills/skillPackage.ts)、[parseSkillImport.ts](../../src/workbench/skillLibrary/parseSkillImport.ts)。真实代码已允许脚本文本，图片仍不随导入信封携带；本期媒体目录不等于导入媒体能力。
- 已有内置包入口：[builtinPacks.ts](../../electron/promptLibrary/builtinPacks.ts)，在线刷新不会覆盖内置内容；不往只在断网使用的 seed 里塞内容。
- 现有创作公式：[LibTV 实物对账](../product/2026-09-07-remediation-real-artifacts.md)。其中公开教程不等于授权，缺明确许可不逐字收录；MIT 仓中单独保留版权的内容也不收。
- 设计真源：[tokens.ts](../../src/design/tokens.ts) 转导出 theme；色彩实际定义在 [nomi-tokens.css](../../src/theme/nomi-tokens.css)。先截现役组件，再画相同外壳。
- 反方来源核实由只读调研任务执行，原始证据与选择结论进入 docs/research/2026-09-08-skill-prompt-curation.md。Context7 本会话未提供工具，以官方网页与源码核对，不伪称调用成功。

## 内容与模型边界
沿用技能 frontmatter 解析器和提示词 LibraryPrompt 模型。技能与节点效果的策展元数据采用同一共享 schema，正文仅在 SKILL.md 保留一份；提示词库通过适配投影读取，禁止另一份正文 JSON。license 是官方顶层字段，来源、appliesTo、分组、槽位、preview 放 metadata.nomi 的内容扩展。仅策展条目强制许可，不把用户私有技能无许可证误判为不可导入。
媒体真实产物优先。缺媒体在锚图获批前保持待制作状态，绝不把插画标成模型效果。现役媒体类型和文本适用性分开：text 是适用节点，不是图片 MIME 类型。

## 不动项
不修改 electron/agentLane/**、src/workbench/ai/lane/**、src/workbench/generationCanvas/**；不实现卡片或节点 UI，不新增依赖，不触主 checkout 和其他 worktree。不批量生成未获批风格。

## 封面与成本
脚本支持 dry-run、--limit；应用 readCatalog → decryptApiKeyRecord，禁止输出密钥。只用 APIMart；付费总上限人民币 6 元。先三张锚图后停止，未选不批量；价格无法核实或余额不足即停止付费但继续独立工作。真实扣费与估算分开报告。

## 回滚
每一里程碑独立 commit，可逐笔 revert。内容随包发布，无持久化迁移；不改变用户库、不改密钥或供应商设置。样张与锚图全为新增文件。

## 验收门
格式：官方 SKILL.md 样例读取成功；策展技能/效果各验证缺许可证与非法 appliesTo 拒收。pnpm run check:skills-format、check:standard-formats、check:i18n、check:tokens 与 pnpm run gates。媒体脚本 dry-run/limit/成本停止条件验证；三张图与接触表亲眼查看。样张分别截图现役库/图片 composer，HTML 与 PNG 对账；说明与 v4 技能引用 chip hover 视频共用同一媒体。最后正常钩子 commit/push、PR，不合并；SL-LAST.md 不提交。
