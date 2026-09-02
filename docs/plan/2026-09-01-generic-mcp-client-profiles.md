# 泛化 MCP 客户端身份 · 支持任意 AI 工具接入

> 状态：🚧 进行中（方案 A 已拍板，2026-09-01 用户确认「按照你的推荐推进」）
> 前置分析：`设计理念/15-自动化权限与自定义AI工具接入方案.md`

## 0. 目标（一句话）

把「客户端身份」从硬编码 `'claude' | 'codex' | 'cursor'` 三值联合类型，泛化成「校验后的字符串 + 可注册 profile」，
让任意支持 MCP stdio 的 AI 工具（WorkBuddy / 豆包 / AutoClaw…）都能接入，同时**完全保留现有安全模型**
（本地 token + HMAC 签名 + 127.0.0.1）。

## 1. 现状（已核实，带 file:line）

| 硬编码 | 位置 |
|---|---|
| `AuthenticatedMcpClient = 'claude' \| 'codex' \| 'cursor'` | `security.ts` |
| `MCP_CLIENTS = Set(['claude','codex','cursor'])` | `security.ts` |
| `CLIENTS` 三张配置路径表 | `mcpConfig.ts:52` |
| `resolveClient` 默认 claude | `mcpConfig.ts:58`、`mcpVerify.ts:60` |
| `isRegisteredMcpClient` 三值 | `generationDispatcher.ts` |
| `TRUSTED_HOSTS = Set(['nomi','claude','codex','cursor'])` | `automationPolicyContract.ts` |

**关键**：`signMcpClient(client)` 的 HMAC 机制本身通用（`HMAC(token, "nomi-mcp-client:v1:<client>")`），
只是参数类型被限定为三值联合。泛化参数类型即可，无需改密码学。

## 2. 方案 A 设计

### 2.1 类型泛化

```ts
// security.ts
const MCP_CLIENT_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/
export type McpClientKey = string  // 语义 = 过 MCP_CLIENT_KEY 校验的字符串
export function isValidMcpClientKey(v: unknown): v is McpClientKey
```

内置三客户端 `claude`/`codex`/`cursor` 是 `McpClientKey` 的子集（都是合法字符串），向后兼容。

### 2.2 注册表（mcpConfig.ts）

- 内置种子：`claude`/`codex`/`cursor`（保留现有 CLIENTS 表）。
- 自定义 profile：`{ key, label, format, configPath, isBuiltin }`，持久化到 settings 目录
  `mcp-client-profiles.json`（复用 `readJsonFile`/`writeJsonFileAtomic`）。
- 新 API：`listMcpClientProfiles()` / `registerMcpClientProfile(profile)` / `removeMcpClientProfile(key)`。

### 2.3 权限泛化

- `isRegisteredMcpClient` / `TRUSTED_HOSTS` 从硬编码集合改为「读注册表 key 集合」。
- 自定义客户端**默认不进 trustedHosts**，需用户显式勾选（与内置一致，但内置默认已在）。

### 2.4 UI

`AutomationPermissionsSection` 的 MCP 接入页新增「自定义 MCP 客户端」卡片：名字 + 配置路径 + 格式 + 接入/复制。

## 3. 不动项（明确）

- ❌ 不改密码学（HMAC 机制原样保留）。
- ❌ 不改 RPC 只监听 127.0.0.1。
- ❌ 不引入任意远程代码、不扩展 preload、不放宽 CSP。
- ❌ 不支持只含私有协议、不支持 MCP 的工具（需各写适配器，违背通用原则）。

## 4. 改动文件清单

| 文件 | 改动 |
|---|---|
| `electron/capabilityCore/security.ts` | `AuthenticatedMcpClient` → `McpClientKey`（校验字符串）+ `isValidMcpClientKey` |
| `electron/capabilityCore/mcpConfig.ts` | 内置种子 + 自定义 profile 注册表 + 新 API |
| `electron/capabilityCore/mcpVerify.ts` | `resolveClient` 支持自定义 key |
| `electron/capabilityCore/generationDispatcher.ts` | `isRegisteredMcpClient` 读注册表 |
| `electron/settings/automationPolicyContract.ts` | `TRUSTED_HOSTS` 读注册表 |
| `src/desktop/mcpBridgeTypes.ts` | 类型同步 |
| `src/workbench/settings/AutomationPermissionsSection.tsx` | 自定义客户端 UI 卡片 |
| i18n | 新增双语文案 |

## 5. 回滚

纯增量 + 类型泛化，无数据迁移破坏。回滚 = revert commit。

## 6. 验收门

- typecheck + lint + 单测全绿。
- `security` / `mcpConfig` 的签名泛化单测（自定义 key 签名/验证往返）。
- 一个「自定义客户端端到端接入」走查（或至少：注册 profile → 生成带签名的 server entry → 验证 proof 可 verify）。

## 7. 分步实施

1. `security.ts` 泛化（最小、风险最低、先做）。
2. `mcpConfig.ts` 注册表。
3. `mcpVerify.ts` + `generationDispatcher.ts` + `automationPolicyContract.ts` 泛化。
4. bridge 类型 + UI。
5. 测试 + 走查。
