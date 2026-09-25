# MCP 启动自愈只修损坏的启动器

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施中。来源：用户 2026-09-17 批次 3 任务书，方案①已拍板。对应 TODO T-RL-05；未合入前不标 done。

## 用户镜头与范围

装正式版又下载测试包的人，过去只需启动测试包，助手配置就被改到测试包；删测试包后助手断线。现在启动任一副本不抢另一个有效启动器，设置里的客户端显示实际路径与「切到这一份」。点击复用 installMcp，回正式版也用相同按钮切回。

删除 launcher-stale 把「不同」视为「损坏」的分支，删除启动后 30 秒 renderer 通知及 toast 消费链。保留坏路径、不可执行文件、废弃脚本的启动自愈、备份和隔离写盘守卫。认证差异不能覆盖有效另一副本的归属判断。已有 profile 缺失仍属于损坏，另一个存在的 profile 属于 elsewhere。

## 边界与不动项

唯一 owner 为 electron/capabilityCore/mcpConfig.ts；JSON/TOML、内置/注册客户端共用分类器和写入门。设置读取不写盘。用户主动切换仍调用现有 installMcp，不增写入路径。不改模型、MCP 协议、信任权限或正式安装目录约定。

## 先查别人

本轮是已批准的内部归属不变量修复，不新增框架或通用能力。实读 #519 引入路径的来历报告、#783 只读收敛实现、mcpConfig.ts 的 classifyMcpEntry / writeClientConfig / sameProfile 与 ConnectAssistantCard 完整现有外壳。路径检查使用现有 node:fs；Windows 以存在性及 access X_OK 的系统语义判定，不按 macOS 安装目录推断身份。

- 依赖已有的检查：`node_modules/@types/node/fs.d.ts:3842` 的 accessSync 接受 X_OK，失败抛错；配合 statSync 的 isFile 判断目录，复用 Node 平台语义。
- 仓库已有的写盘入口：`electron/capabilityCore/mcpConfig.ts:512` writeClientConfig 已统一内置与自定义客户端的 JSON/TOML、备份与拒绝写入；主动切换继续使用它。
- 仓库已有的读零写盘约束：[MCP 连接真实性方案](2026-09-14-mcp-connection-truthfulness.md) 和 [读路径事故教训](../lessons/mcp-read-path-must-not-write-host-configs.md) 要求设置展示磁盘事实，不能用打开页面来迁移配置；本次在这一边界延伸归属状态。

## UI 与控制层级

复用设置「管理连接」客户端卡现有状态区域、现有主操作位置与 IconRefresh。elsewhere 替代原失效提示和「升级接入」，不增加并列按钮。路径可换行；中英同构。任务书已批准文案和动作，属现有状态的小修改，不重复请求拍板。正式界面截图逐项核对状态、实际路径、唯一切换按钮和读零写盘。

## 里程碑与验收

1. 根因合同、门表、红灯回归，提交文档与测试。
2. 分类边界、设置状态、删除 toast 链，旧六条覆盖保留，定向验证后提交。
3. gates 与指定七段 CI 顺序走查全部收齐，修红后复验；正式包/走查包启动配置字节对账、中英截图；交工评审。

回滚：按里程碑 git revert；客户端主动写入仍有 .nomi-backup。不 push、不建 PR，不修改别的 worktree 或主仓。

## Ponytail

adc64d26f 分支评审两块：一条建议已改，另一块通过。归属分支已确保 command 相同，后续直接调用 sameProfile，删除重复 sameLauncher 包装与过时注释。mcpConfig 49 条单测复验通过。
