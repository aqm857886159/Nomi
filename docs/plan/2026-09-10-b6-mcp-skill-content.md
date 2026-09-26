# B6 C54 MCP 技能内容对等

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现，真 stdio / 打包验证已通过，gates 执行中
日期：2026-09-10

## 先查别人
- MCP resources 2025-11-25：https://modelcontextprotocol.io/specification/2025-11-25/server/resources 。资源以 URI 标识，read 返回 text/blob；自定义 URI scheme 是标准扩展点。我们只暴露包内已纳入内容 hash 的文本，不开放任意本机路径（领域边界）。
- MCP prompts 2025-11-25：https://modelcontextprotocol.io/specification/2025-11-25/server/prompts 。prompts/get 参数属于 arguments；版本/hash 移入标准 arguments，并在 _meta 提供包身份。移除原有非标准顶层字段。
- Agent Skills：https://agentskills.io/specification 。SKILL.md 可引用 references/assets/scripts；只给正文会失去依赖。沿 `electron/skills/skillPackage.ts:202` 文件白名单与内容 hash，资源按需披露，脚本只读不执行。
- 仓内近邻：`electron/agentLane/laneInstalledSkills.mts:19` 拒绝符号链接；`electron/skills/skillStore.ts:171` 从完整文件表计算 hash；`electron/capabilityCore/mcpProtocol.ts:705` 原来仅投正文。

## 方案与范围
在 skillStore 的 MCP 内容边界读取同一安全包文件表，校验整包 hash，列表增加文件名元数据。根 URI 保持 SKILL.md 身份；附件 URI 追加编码相对路径。resources/read 按身份和白名单读取，拒绝路径穿越、缺失和过期身份。prompts/get 返回完整正文与附属资源引用，保持渐进披露。
只修改 skillStore、dispatcher 的 skills 分支、mcpProtocol 技能段及 mcpSkillResources URI 投影、对应单测和 mcp-skills-integration 真 stdio 走查。无 UI 或脚本执行能力变更。

## 验收与回滚
先红：协议单测证明附件不可读与标准 arguments 被忽略；包存储单测证明附件缺失。后绿：覆盖资源附件逐字读、空文本、版本变化、私有包/越界拒绝；真实 stdio 与打包 smoke 由总任务执行。回滚只 revert 本任务提交，不改用户资料。

## 六角色反方复核
CTO：复用已存在包读取器而非另造文件系统 API。设计：元数据列表不塞正文。PM：技能引用可真正被外部读取。前端：无界面改动。后端：整包身份约束和可见性先于文件读取。真实用户：从返回 URI 直接读附件，不需猜本机路径。

## 局部验证收据
- 先红：`/tmp/b6-c54-red.log`，2 文件 6 failed / 13 passed（附件目录、正文和标准 prompt identity 断言）。
- 后绿：`/tmp/b6-c54-green.log`，3 文件 23 passed；包含私有包、过期 hash、空文本、路径穿越及标准官方请求夹具。
- `node scripts/check-root-cause-contracts.mjs` 与 `node scripts/check-standard-formats.mjs` 通过。
- 未改 Nomi GUI。外部工具标题/协议内容不出现在现有 MCP 设置截图中；最终交付不得把连接设置页冒充本次内容变化证明。
