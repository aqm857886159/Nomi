# WorkBuddy 一键 MCP 客户端档案

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施中。用户已指定按 Pi 提交 121c314eb 的既有单卡/分段控件接入；不另设 UI。

## 先查别人

- 先查别人：已逐文件读取 121c314eb；沿用 electron/capabilityCore/mcpConfig.ts:57 的 CLIENTS 和 jsonInstall/jsonSnippet。既有 mcpVerify、dispatcher、保留 key 都由 security.ts 的 BUILTIN_MCP_CLIENTS 派生，无需再加条件分支。
- 规范链接：https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide （2026-09-09 实抓 HTML，用户级 ~/.workbuddy/mcp.json，项目级 .workbuddy/mcp.json，mcpServers）。我们的偏差 / 理由：无偏差。只写用户级，因为 Nomi 不知道外部助手当前项目。
- 仓库已有配置保留验证：electron/capabilityCore/mcpConfig.test.ts:85；jsonInstall 的 reader/writer 已登记在 docs/engineering/standard-formats.json:165，不引依赖、不新增合并器。
- 本机 ChatCut 的 stdio 条目作为保留形状先例，测试只使用无密钥夹具。读取器沿用已登记 mcp-servers-config，追加 WorkBuddy 官方样例和来源。
- 扩展内置身份、文案、来源展示、权限列表。目录检测仅表示宿主存在，不能冒充 Nomi 配置完成；未配置时可默认选中检测到的 WorkBuddy。

## 不动项与回滚

不动 agentLane、AI lane、React Flow、其它宿主行为、通用 JSON 合并算法、WorkBuddy 内部 .mcp.json。回滚仅撤销本提交；真机验证 finally 还原用户级文件原始字节并核验 diff 为空，不打印凭据。

## 验收门

1. 官方夹具可读；写入保留 chatcut_desktop 和其它字段，snippet/身份/撤销一致。先用丢条目的变异证明保留断言会红。
2. 独立 Electron 开发构建走设置页：WorkBuddy 选项→一键接入→snippet 一致→重新打开保持配置；截图人眼对照 Pi 布局。
3. 本机临时写入→open -a WorkBuddy→5 秒后截图，尽力进入插件 MCP Servers；如无法驱动如实报告；原配置字节差异为零。
4. 完整 python3 scripts/with-gates-lock.py -- pnpm run gates exit 0，按 hooks commit/push 后开 PR；不合并。

## 走查收据

- 两份单测 38/38；破坏 jsonInstall 的保留语义时 WorkBuddy 测试 exit 1，恢复后 exit 0。
- 隔离 Electron 走查通过；真实 HOME 只映射 .workbuddy，写入、snippet、重开一致，33 个 MCP 工具可握手。明亮截图中五个宿主选项完整可见，保持 Pi 原有布局。
- 真机 WorkBuddy v5.2.6 主窗已打开并截图；未能点进插件页，不能声称已在 WorkBuddy 的 MCP Servers 中看到 nomi。
- 真实用户级文件还原后 Buffer.equals 为 true（byte diff empty）；内部文件在 Nomi 写入后、WorkBuddy 启动前不变。WorkBuddy 重启会自行重写内部代理文件，因此启动后不对其做还原写入。
- 走查自身收尾断言曾误把第三方拥有的动态文件当成静态文件；按 root-cause-remediation 查了隔离夹具与真实启动两个入口，收敛为「Nomi 操作后检查内部文件、只还原自己借用的用户级文件」。未修改生产合并逻辑或第三方文件。
- 无真实模型调用，额度花费 0。模型雷达发现 5 个新增，apimart-llm 因凭据不可解密今天没查成；雷达产物单独保留，不纳入此 PR。仓库没有可用的 nomi-research-radar / nomi-model-radar 技能，未生成论文雷达或新增模型分诊。
