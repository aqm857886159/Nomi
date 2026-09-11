# 先查别人 —— 「用 AI 帮我接入」入口

> 2026-09-11 · 服务于 [docs/plan/2026-09-11-ai-assisted-onboarding-entry.md](../../plan/2026-09-11-ai-assisted-onboarding-entry.md)
> 结论先说：**这件事仓库里已经有八成，缺的是入口位置与「跟助手说什么」那一份文本。**新造一张接入卡是并行版（P1），不做。

## ① 依赖里已有？

- **pi 自带 Agent Skills 加载器**：`node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js` 的 `loadSkillsFromDir`
  已经是本仓 `check:skills-format` 的第六条判据（`scripts/skills-format-lib.mjs:160`）。
  **用已有**：新技能包不写第二种清单格式，直接进 `skills/`，由那道门岗判它「别的宿主读不读得出来」。
- **`zod` → JSON Schema 已在依赖里**，`compileRequest.contractSchema` 就是它派生的（`electron/providerAdapter/agentCompileRequest.ts:28`）。
  **用已有**：SKILL.md 正文不再抄一份字段表，只告诉助手「照 `compileRequest` 返回的 schema 写」。

## ② 仓库里已有？

- **能干这活的卡已经存在**：`src/ui/onboarding/ConnectAssistantCard.tsx:1` —— 宿主分段、一键写各家 MCP 配置、
  复制配置、实连验证（`verifyMcp`）全在里面，只是住在「自动化与权限 → AI 助手连接 → 管理连接」这个二级页
  （入口 `src/workbench/settings/AutomationPermissionsSection.tsx:213`），文案还只说「让助手帮你建项目、出图」。
  **用已有**：一键接 MCP 这件事**继续由它独占**，新卡一颗都不复制；新卡只补它没有的那半——「跟助手说什么」。
- **接入契约已经完整**：`electron/capabilityCore/mcpIntegrationTools.ts:11-15` 的六个 action、
  `:67` 的 `docs`（≤64KB）、`:41` 的 `adapterDraft`。SKILL.md 正文逐条对着它写，不是编的流程。
- **阶段词表已有唯一 owner**：`electron/shared/integrationContract.ts:4` 的 12 个 stage。
  **用已有**：进度条是它的投影（`src/ui/onboarding/assistedProgressProjection.ts`），不新造状态机。
- **握手队列已有渲染层通路**：`src/desktop/onboardingBridgeTypes.ts:133-155`（list / subscribe / sessionGet）。
  **用已有**：「谁在推这次接入」从 `ownerClientId !== 'nomi'` 判，不新加 IPC。
- **凭据只有一条合法路径**：`integration.open_credentials` 弹 Nomi 本机安全页
  （`electron/capabilityCore/dispatcher.ts:741`），MCP 参数里永远没有 key。
  **用已有**：卡上不放第二个 Key 输入框。
- **未签名外部客户端也走得完接入**：`electron/capabilityCore/dispatcher.ts:725-790` 里只有 `integration.manage.*`
  要求签名身份；`begin/propose/confirm/start/cancel` 对 `external` 开放。
  **结论**：给「其它」宿主的那段通用 MCP 配置（不带客户端签名）**是真能用的**，不是画个样子。

## ③ 生态里已有？

- **Agent Skills 规范**（<https://agentskills.io/specification>）：frontmatter 只有 `name` / `description` 两个必填，
  `metadata` 是官方给的客户端自定义扩展点，顶层键是闭集。**对齐**：新技能包只用标准键，Nomi 独有信息挂 `metadata.*`
  （R31：不另起 `skill.json` 那种平行文件）。
- **Claude Code 装 MCP server**（<https://code.claude.com/docs/en/mcp>）：stdio 形状是
  `{"mcpServers":{"<name>":{"command":…,"args":[…],"env":{…}}}}`，也是 `.mcp.json` 的项目级形状。
  **对齐**：「其它」那段片段照这个形状生成（与主进程 `mcpConfig.jsonSnippet` 同形，夹具
  `tests/fixtures/standard-formats/mcp/.mcp.json`）。
- **Codex 装 MCP server**（<https://learn.chatgpt.com/docs/extend/mcp?surface=cli>）：`codex mcp add …`，
  配置落 `~/.codex/config.toml` 的 `[mcp_servers.<name>]`；该页**没有**提到 Agent Skills / SKILL.md。
  **偏差与理由**：因此任务提示词不能假设「宿主一定装得下技能目录」——正文里明说
  「有技能目录就存进去，没有就直接照它做」，SKILL.md 原文本身就是可执行的说明书。
  这是实施阶段发现、板上没有的一条（见方案文档「没想到」）。
- **没有可对齐的标准**：「让一个外部 coding agent 替用户把模型接进本机桌面应用」这件事，
  生态里没有通行格式可抄——最接近的是各家自己的 `skills/` + MCP 两件标准件，我们把它们拼起来用，
  没有自定义任何新格式。

## ④ TikHub 自媒体里怎么说？

本轮**没有查成**：任务是入口位置与文案，不是选型或新能力，`TIKHUB_API_KEY` 也不在本 worktree 环境里。
按纪律明说「今天没查成」，不当作「查过且没有」。真要补，问题应该是「普通用户第一次给桌面 AI 工具接模型时卡在哪一步」。

## 结论

**全部用已有**：卡（ConnectAssistantCard）留在原家不动、契约（`nomi_integration`）不动、阶段词表不动、
格式（Agent Skills / `mcpServers`）对齐官方。本轮真正新写的只有两样：
① 一份标准 frontmatter 的 `agent-skills/nomi-add-model/SKILL.md`；② 模型页顶部那张把它交到用户手上的卡。
