30 天 14 次修复（协议登记 7 次）· 归为 5 类 · 根因：协议已统一，领域状态与确认仍分散装配 · 替换卡在旧宿主收口及确认协议迁移 · 推荐换一种做法；未跑真机/付费，兼容性待验。
# 外部 Agent 宿主层方向检查（2026-11-16）
基线：HEAD = origin/main = 0fe41c52c；只读复盘，未改仓库。事实来自用户原始会话第 8–10、16–18、21 条和独立复现报告 §1–4、6；后者基线 d299ae902 至本基线的 electron/capabilityCore/ 无差异；其复现用隔离数据与假上游，非本次真机复跑。
**这一处的全图：表外。** seams.json 尚无完整的外部宿主交接处；下图即待登记的全图，本文不改登记。
全图：HTTP／旧 Node 启动器 → createNomiMcpServer → callMcpLoopbackRpc → rpcServer → dispatchAndEnrich → dispatcher/generationDispatcher → generationPlanning → 执行合同／Run 授权／提交；Electron stdio 在 GUI 开着时同走 RPC，GUI 不在时经 createMcpStdioDirectInvoker → 同一 dispatcher，但依赖来自它自己的装配。
量具：逐个运行 `node scripts/door-map.mjs <符号>`：createLiveGenerationRuntime = 2 写门（appIntegration:202、mcpStdioServer:274）；createGenerationPlanningHandler = 3 写/1 读（剔除 TestUtils 后 2 个生产装配）；createNomiMcpServer = 4 写/1 读（剔除进程内测试桥和类型引用后 3 个生产入口）；createLoopbackGenerationConfirmation = 3 写门。均为 electron/capabilityCore/ 下路径；不是 5 个生产宿主。
各存一份的是 runtime、启动 registry、operationStore 门面、planning/prepareAuthorization/start/reconcile 接线和默认 authorities；磁盘目录、Run 服务实现已有复用，不是两份模型数据库（appIntegration:184–215,341–470；mcpStdioServer:229–235,274–456）。

## 0. 一句话根因
缺的是领域装配的唯一所有者和跨调用生命周期契约：同一目录在起草时重读、在预览/付费门时读启动快照，确认又按工具各选通道；官方 SDK 已接管协议，不能替这层保证一致。
创作者在 Claude 里接模型、试拍成功，再要求正式生成，却先看到 Unknown model，换内置模型又看到 configured_provider；试跑要求切回 Nomi 点确认，无窗口还被说成没确认。聊天应只做必要请示与指路，模型/草稿仍在工作台自己的家（设计系统 §1.0）。

## 1. 归类表：修复提交 → 直接原因 → 类
口径：2026-11-16 执行指定 `git log --since='30 days ago' --format='%h %ad %s' --date=short origin/main -- <路径>`，遍历 mcp-protocol 全部 14 路径及 appIntegration.ts，逐提交读 stat/正文；fix 去重 14 = 登记 7 + 应用文件 8 − 重叠 1，排除 merge/feat/refactor。fix-churn 实报应用文件 14 天 5 次、登记 30 天 7 次；“第 6/8 次”是待提交计数。
类：A 状态/授权归属与重复装配；B 能力声明和执行投影不一致；C 自写连接装配误读协议/传输生命周期；D 用户所在界面及状态不可见；E 其它领域或构建边界。以下每提交只记主类，不能把 14 次都解释成协议 bug。
| 提交 | 直接原因 | 类 |
|---|---|---|
| 4c0b435aa | 4 个已声明画布操作没接渲染路由，调用回不支持；改为类型约束路由表 | B |
| 6123d2754 | 探针只 close 本地未 DELETE 服务端会话；404 不重握手，错误一律说没开 | C |
| 8b2e31d58 | HTTP 起服务失败只写日志，连接卡看不到端口冲突 | D |
| af7dcd720 | keep-alive 旧连接复位被当成应用没开，探活沿用错误判据 | C |
| 714b8d49d | 上传授权比较整项目/Run revision，Nomi 自己投影也作废授权；两个宿主同改 | A |
| 964967ef0 | 自写 schema 白名单/投影与通用模型标准不符；发布与执行约束需同源分开 | B |
| 962e31728 | 已付费且有任务号的观察失败被终结，物化中途崩溃未统一收尾 | E |
| 05632adb2 | 共享 schema 模块把 CJS 校验器带入渲染，单份 Vite 别名遮不住其它构建入口 | E |
| 54bcef6de | 分镜/画布恢复判据和队列取消分散，未完成 Run 占用的解释不一致 | E |
| 3797fde0c | 持久拒绝把在途作业锁死；改为列出未结作业、明确知情后重发并继续观察旧作业 | E |
| c05ac86b4 | 观察者只把迟到结果写进 Run，画布单镜无按原运行号投回路径 | E |
| c259eb988 | 多处假定一次运行只有一个产物，付 N 张的钱只落一张 | E |
| 302497119 | 多入口自己挑窗/聚焦，窗口生命周期没有唯一主人 | D |
| 3c0e2022c | 用本机解析地址拦代理及本地后端，地址判据不适用；删除该层 | E |
本次未提交现场另属 A：appIntegration:209,215 与 mcpStdioServer:281,283 固定 initialGenerationScope.registry；mcpGenerationTools:491,548 起草却读 createDraftScope，:258,594,645 合同/preview/gate 读 deps.registry。

## 2. 为什么这一类一直出现
两种口不该混算：协议的三个生产入口已共用 createNomiMcpServer；领域的两个宿主仍手工填同一套依赖。接口同时接受必填 registry 和可选 createDraftScope（mcpGenerationTools:95–98），类型允许两者代表不同时间的目录；名字叫 live 也不会刷新已捕获对象。
最早应拦在设计验收：2026-10-05 替换卡 ★9 钉协议帧/工具面，mcpWireContract.test.ts 明用 fakeHost，liveGenerationRuntime.test.ts:29–104 只验工厂下一次捕获，没有贯穿两个真实装配的“启动→挂卡→起草→门”。装配门岗 scripts/check-transport-assembly.mjs 只查 McpHost 的可选键；本次实际运行 1 接口/6 成员/3 装配全绿，不能证明状态新鲜。
对应铁律⑪“能选到”和⑫“点了=以为的”：读到可用却进不了门、无窗口却报未确认；⑩尚无用户意图与最终请求逐字段证据，不作已违背结论。空卡仅有代码与独立复现报告分析，未在真实 Claude 亲眼确认。
系统改进建议：先把领域依赖收成一处、删除宿主自持 registry 接口，再在现有验收矩阵增加跨入口生命周期；不是再加一份“记得同步”的规则。正例用本次挂卡后正式 gate；旧案用 appIntegration:347–354 记录的 9 月 22 日漏接素材身份解析器；不应拦的真实样本用 714b8d49d 后 generationReferenceScope.test.ts:64 起的 Nomi 自身投影更新，用户改参考仍须拒。以上是待实施验收合同，未宣称本次已实现或跑通。
连接污染是另一个领域缺陷：独立复现报告 §2 已区分干净 key 可过、挂卡写 assetIngestion 后被拦、删模型后仍拦；统一宿主不会自动修好它。单条生成的有上限授权不存在，也不能用全局 full_auto 冒充预算授权（报告 §4）。

## 3. 不改结构，接下来会冒出什么
| 可证伪预测 | 命令或步骤、通过判据 |
|---|---|
| 长驻进程中新增/删改模型，起草与 preview/gate 仍可能给相反答案；重启改变答案 | 在隔离假上游按报告 §1：启动→挂到新连接→读模型→plan→preview/gate；新增应无需重启可进入确认，删除后各面同拒。再用已有连接跑，区分连接污染，不能只测新工厂 |
| 下次新增依赖会再次只接一个宿主，现有装配门仍可能绿 | `node scripts/check-transport-assembly.mjs` 加两装配的同一带参考图草稿用例；量具必须核素材身份、合同与拒绝码，不只核键名/工具数量 |
| 试跑与正式门仍在不同地方确认；放开新协议而保留反向请求会失败 | 隔离客户端 form 有/无 × Nomi 窗口有/无，对比 try_model 与 gate；显式拒绝/无界面分开、未授权派发数为 0。再协商 2026-07-28，须经 input_required 重入且只派发一次 |
复查建议：2026-11-23，由协调安排独立验收；量具为上述逐入口记录、领域装配数、授权前供应商 POST 数。目标 2 处手工领域装配收成 1 个工厂/权威边界、状态差异 0、未授权 POST 0；未达标重开方向检查。日期与责任是提案，不是已安排的任务。

## 4. 靶子独立性检查
用户会话原话、另一条只读线的命令/原样返回、这次源码/历史扫描是不同来源；本次没有参与此前修复，也没用修复线方案定结论。原验收是否由同一实现者编写无法从限定材料确定；窗口/旧宿主真机收据不足，不能用假宿主协议全绿替代。
限定历史未发现“修对反而掉分”的充分证据；但现有 widget 特征测试 :527 只检查 project_create 不挂 UI，没检查 nomi_read 的非 Run target。应修这个尺子的覆盖范围，不把空卡解释成用户拒绝；当前 SDK 动态登记能力也已推翻计划中“只支持静态登记”的绝对说法。

## 5. P0：现成方案、替换进度与登记去向
代码核对：第 0/1 段已用 SDK Server、StdioServerTransport、fromJsonSchema；第 2 段 HTTP/桥在；第 3 段 migrateMcpHostsToHttp 和受信 IPC 在（mcpHostMigration:178、mcpProfiles:25–31）；第 4 段 usageRegistry/IPC/RPC 计数在。计划页仍把后两段写“计划”，已过时；这些存在不等于真宿主迁移和界面已验收。
真正没收完：mcpStdioServer 仍装领域运行时，mcpNodeLauncher:166,349 仍冷启并组协议，mcpConfig:480–506 连新条目也写旧 stdio；新转发器已存在却是另一个入口。保留旧连接/被动发现不冷启的兼容要求仍在，用户是否迁移完未知；“迁移机制还没写”已不是阻碍。登记 mcp-protocol 仍 to-replace，不能现在把全部路径改 justified。
另一个真阻碍：mcpProtocol:94 只开旧协议，:279–297 仍 server.request elicitation/create；确认重入、一次性收据、会话信任尚未迁移。聚合 union 超集和校验前容忍仍是实际约束（mcpTransportSchemaFromZod:1–19），保留低层 Server 有依据；官方 SDK 不替 Nomi 决定花钱范围、模型就绪与撤销语义。
先查别人（2026-11-16 实读；网页部分重开失败后用 GitHub 固定 tag 源码复核）：
- [官方 SDK v2.4.0](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.4.0)／[HTTP 工厂](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/docs/serving/http.md) · createMcpHandler 管 HTTP 协议装配、按请求造 server · 支持换法；共享领域工厂，不把多客户端塞进一个可变会话实例，也不直接套到当前旧协议会话上。
- [工具注册源码](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/packages/server/src/server/mcp.ts#L1391)／[工具文档](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/docs/servers/tools.md) · registerTool 管 schema/校验，句柄可 update/remove/enable/disable，更新会通知列表变化 · “静态登记所以不能换”已失效；仍须证明语言、前置容忍和统一审批边界能保住，SDK 不会自动刷新 Nomi 目录。
- [官方确认协议](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/docs/servers/input-required.md) · 新协议 inputRequired/acceptedContent 处理请求与重入回答，旧 elicitInput 在新协议抛错 · 支持把通用确认传输交 SDK，授权真实性与幂等继续归 Nomi。
- [官方 Apps v2.1.0](https://github.com/modelcontextprotocol/ext-apps/blob/v2.1.0/src/server/index.ts#L251)／[依赖范围](https://github.com/modelcontextprotocol/ext-apps/blob/v2.1.0/package.json#L116) · registerAppTool/registerAppResource 管 UI 元数据和 HTML 资源，peer 支持 SDK v2 · 可替手写标准注册；要求高层注册接口，非低层 Server 即插即用，业务卡片与客户端渲染仍须验。
- [Mastra MCP](https://mastra.ai/docs/server/mcp)／[route:99](https://github.com/mastra-ai/mastra/blob/main/packages/server/src/server/mcp/route.ts#L99)／[catalogue:539](https://github.com/mastra-ai/mastra/blob/main/packages/server/src/server/mcp/catalogue.ts#L539) · 每请求从当前 Mastra registry/内部 Agent 工具派生 MCP 工具，执行复用 HTTP route 权限 · 支持同源装配与执行，外部投影仍可独立。
- [Langflow 内部 Flow 工具](https://github.com/langflow-ai/langflow/blob/main/src/lfx/src/lfx/base/tools/run_flow.py#L339)／[外部 MCP](https://github.com/langflow-ai/langflow/blob/main/src/backend/base/langflow/api/v1/mcp_utils.py#L368) · 同一 Flow，内部 ComponentToolkit/run_flow，外部从数据库收工具并走 simple_run_flow；是两种适配，MCP 路由共享 handler · 证明共享领域数据可行，也提醒不能把“双适配”误写成已统一全部状态。
登记去向建议：保留 to-replace 到旧入口收成薄兼容层、确认迁移和标准 UI 注册验收后；届时删除已被 SDK/公共工厂替代的路径，只把剩余身份、领域投影、宿主配置迁移列 justified。2026-11-23 复查；不以时间到了自动退役，不以 SDK 升级替代用户兼容验证。

## 6. 三条路对比与推荐
| 路 | 做什么 | 代价/风险 | 判断 |
|---|---|---|---|
| 沿原方向修 | 两宿主逐处改活目录、补确认与展示条件 | 当次成本低；2 处装配和多套生命周期仍在，后续靠同步与更多检查 | 不推荐作终局 |
| 换一种做法 | 用户定后由实现线按“领域运行时→确认→传输兼容”单元收口；先共享唯一领域装配、每次操作捕获一致目录，再接官方 SDK v2.4.0 的可替通用能力/Apps v2.1.0，分别删旧 | 中等成本；保留低层领域投影直到动态目录/容忍/审批等价成立。独立验收先过再迁旧宿主，不同时重做供应商/模型接入路线 | 推荐；先完成最早共享边界 |
| 删掉 | 最小先删两个启动 registry 常量及第二份领域装配；进一步删除 Electron stdio 的独立生成宿主，保留必要兼容转发与被动发现 | 前项不改用户连接；后项会影响旧 stdio 无 GUI 的读/写与冷启，必须先按既定同意迁移、备份恢复跑通，不能直接删整个 MCP 或强改用户配置 | 作为换法的删除部分；第二宿主退役待兼容证据 |
对正在做的一刀的独立判断：只在两个宿主把快照改成活读，属于“沿原方向修”的局部修补，有效但尚非装配层结构性删除；它删掉陈旧值，却没删双来源接口/第二装配，现有资料也不能证明每次合同与就绪状态取自同一目录版本。若同时删除旧 registry 注入口、把操作级捕获归同一共享边界，才是推荐路线的第一步；未查看实现 diff，不判断它实际已做到哪一项。

## 7. 用户要权衡的核心
要不要把“旧宿主各自也能做一整套”的兼容成本，换成“同一套领域能力、少量明确的传输适配”，并先验证老连接还能用；推荐换，保留花钱确认和数据保护。
用户拍板（2026-11-16）：选「换一种做法」，现在只批第 1 段——领域装配收成一处、两个宿主共用同一套。第 2 段（确认改走官方确认协议、在外部客户端里确认和批准一次的范围）先出对比图再定；第 3 段（独立宿主退成薄转发）先有老连接的兼容证据再单独定。
特征测试清单：现有 electron/capabilityCore/{mcpWireContract,liveGenerationRuntime,generationReferenceScope,mcpHostReliability,mcpHttpBridge,mcpMigrationEntry}.test.ts 已读相关现状，未复跑；尚缺真实两装配的动态目录全流程、try_model/gate 确认对照、非 Run 读卡真宿主验收，本次只读不能新增。独立复现报告是现场证据，不能冒充这些缺失测试已补齐。
未做：代码修复、运行 Nomi、真宿主 UI/付费、安装 SDK、读取指定记录以外的用户资料或修复线文件；保留的迁移/确认风险待验证；方向已由用户定（见上一行），第 2、3 段各自另定。
