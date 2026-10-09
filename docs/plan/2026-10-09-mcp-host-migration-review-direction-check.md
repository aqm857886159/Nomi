# 方向检查：MCP 宿主配置写入面的类根因复盘（#1142 评审 4 条阻断）

触发：`fix-churn` 对 `electron/capabilityCore/mcpConfig.ts` 报「真实 MCP 客户端的隔离环境与能力证明」概念 14 天内已有 3 个 fix；本轮评审又判了 4 条阻断，都落在同一片地（宿主配置怎么写）。本文按 `docs/engineering/direction-check-template.md` 写，提交带 `Direction-Check:` 指向它。

## 0. 一句话根因

「往别人家配置文件里写 Nomi 那一条」没有**一个**同时管住「谁能改传输方式、谁在同时写、写之前文件还是不是读到的那一版、验证时往哪里发身份」的边界——这些规则分散在 installMcp、启动修复、迁移、验证各处，各自成立、合起来有洞。

## 1. 归类表

| 评审阻断 | 直接原因 | 类 |
|---|---|---|
| 1 「修复」把已迁移条目写回 stdio | `writeClientConfig` 只会写一种形状 | 写入边界不认识传输方式 |
| 2 并发写 / 宿主热写 / 临时名固定 | `atomicWrite` 无锁、固定 `.nomi-tmp`、备份存在检查非原子、换名前不比对 | 写入边界不保证互斥与版本 |
| 3 验证把身份发往任意 URL | `verifyHttpEntry` 直接 `new URL(配置里的值)` | 读回的配置被当成可信输入 |
| 4 转发口被判成「另一份 Nomi」 | 分类器只认旧启动器形状 | 状态词表没有给新形状留位置 |

## 2. 为什么会一直出现

写入面没有单一 owner：配置形状在 `mcpConfig`、迁移在 `mcpHostMigration`、地址在 `mcpHttpEndpoint`、写盘在 `atomicWrite`，每加一种宿主写法就多一处要同步改的地方。落到铁律：⑫「点了=以为的」——用户点「修复」以为是修，实际换了传输方式。

## 3. 不改结构的话会冒出什么

| 预测 | 验证 |
|---|---|
| 以后新增宿主 / 新传输（例如 WorkBuddy 的 HTTP）时，又有一个入口把它写回旧形状 | `mcpHostMigration.test.ts`「评审 1」逐宿主点修复，传输不变 |
| 宿主热写 + Nomi 重写再次丢数据 | 「评审 2」读完后宿主改文件，迁移放弃且宿主内容保留 |
| 配置里的地址被别人改掉后，凭据再次被发出去 | `mcpHostMigration.realHost.test.ts`「评审 3」改地址后不发请求 |

## 4. 靶子独立性

评审是另一条线（Codex 对抗评审）做的，测试由实现线按评审结论补；不存在「修对了反而掉分」的评测。

## 5. P0：是不是我们独有的、现成方案

互斥锁用仓库已有的租约设施 `electron/productionRun/productionRunLock.ts`（排他创建 + 过期回收 + 围栏），没有引 proper-lockfile，也没有自己再写一套。临时文件、原子换名沿用 `jsonFile.renameSyncWithRetry`。条目形状是 Nomi 往别家宿主写自己那一条的领域，自写已登记在 `docs/engineering/self-written.json` 的 MCP 条目。

## 6. 补 / 换 / 删 对比

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 现成租约设施做互斥（已用）；写入形状无现成库 | 小 | 低 | 已采用 |
| 补 | 在各入口各加判断 | 小 | 下一个入口又漏 | 否 |
| 重写（限一个模块） | 把写盘门、条目形状、读回收口到 `hostConfigWrite` + `mcpHostEntries` 两个模块，installMcp / 迁移 / 验证都走它 | 中 | 低（有 38 条测试） | **本次做法** |
| 删 | 删掉 installMcp 对已迁移条目的写能力 | 小 | 用户修复路径消失 | 否（改成同传输重写） |

## 7. 用户要权衡的核心

「修复」按钮对已迁移的用户只会按同一种传输重写；想回旧连接方式必须走显式恢复函数——这一版界面上没有那个入口（缺口已写进 PR 正文）。

## 特征测试清单

`electron/capabilityCore/mcpHostMigration.test.ts`（38 条，含评审 1/2/4）、`mcpHostMigration.realHost.test.ts`（评审 3 与真握手）、`mcpConfig.test.ts`（既有，唯一红是 Windows 上既有的 walkthrough 一条）。

## 自写登记 mcp-protocol：为什么现在换不了现成方案、哪天换

登记条目 `mcp-protocol`（`docs/engineering/self-written.json`）覆盖 MCP 接入的领域部分。本轮命中的是其中「往别家宿主配置里写 Nomi 自己那一条」：各宿主（Claude Code / Codex / Cursor / Claude Desktop / WorkBuddy）官方只提供手改文件或各自 CLI，没有「第三方应用安全地往里写一条并保证备份、互斥、恢复」的库；握手验证已经用官方 SDK Client，互斥用仓库已有的租约设施，所以自写的只剩条目形状与迁移同意语义。重新评估的时点：某个宿主提供官方的「注册外部 MCP 服务」API（而不是改文件）时，或删旧 stdio 启动器那一版（`revisitWhen` 已写在登记里）。
