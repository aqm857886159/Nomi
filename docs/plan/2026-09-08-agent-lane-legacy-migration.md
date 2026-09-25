# 阶段 4 · 第 3 步旧对话迁移

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施中。第 2 步已完成并推送 a3636be0c；本节接续已批准总任务书 §3 和迁移 readiness / implementation brief。

## 范围与顺序

1. 从 tests/agent-runtime/replayShadowSources.mts 抽共享纯解包 owner laneLegacySources.ts。保留每个原项 raw/sourceIndex、每个独立会话、容器与 leaf/clear 事实；L2 只从结果派生窄回放视图，不能把丢字段后的回放输入当迁移数据。
2. 完整性与转换：严格核验 pi envelope/branch/compaction、host checksum/binding、context v4 record key；同一会话的优先级只由绑定证明。未知内容只归档，不执行。
3. 事务：固定来源路径、跨 await admission/锁、原字节 hash 归档、公开 append API 前缀恢复、冷验、manifest 完成后清理活跃源。G5 收据完全不动。迁移入口在 workspace 开放前。
4. 顶部来源提示只在迁移 lane 显示，事实从同一 transcript metadata 派生；三来源 tmp 夹具和真实 Electron 无额度走查。

## 先查别人 / 既有承接

- pi 0.85.1 公开 appendMessage / appendCustomEntry 是既有获批持久化入口；使用已安装 node_modules/.pnpm/@earendil-works+pi-agent-core@0.85.1_*/node_modules/@earendil-works/pi-agent-core/dist/harness/agent-harness.d.ts，禁止直写 JSONL。规范：https://github.com/earendil-works/pi/tree/main/packages/agent-core 。本次没有自定义第二套对外转录。
- 旧三来源以真实 writer 为格式规范：electron/harness/context/contextStore.ts:25（v2/v3/v4 容器）；electron/harness/runtime/pi/snapshot.mts:19（信封与 SHA）；electron/projectAgentHost/projectAgentRepository.ts:97（host checksum base）。领域偏差：只保留旧数据，不重放旧命令，不恢复旧授权。
- 现有 SessionRepo owner electron/agentLane/laneSession.mts:56；现有 legacy 锁/搬移手法 electron/projectAgentHost/projectAgentMigration.ts。不得调用会删除 receipt 的旧整套迁移。
- 纯解包不授予绑定/完整性信任：parser 标出格式与原始身份；事务入口必须完成上述验证后才能 append/归档清理。

## 验收与回滚

每个原数组成员有唯一 sourceIndex/raw；不按时间重排，不跨 thread 混合，不吞未知项；空/损坏/不支持区分。三来源用 os.tmpdir 夹具，不读真实项目。转换、前缀恢复、锁跨 await、崩溃断点、冷重启均须测试。每个子任务 commit/push 更新 SWITCH-LAST.md。回滚 revert 对应提交；落盘阶段原件永久保留于本次 archive，不用恢复开关。

## 来源准入子任务

`laneLegacyIntegrity.mts` 核验来源状态、pi checksum/分支图/leaf/compaction、v4 完整项目绑定/sessionKey/record key，以及 host checksum/双 binding/revision/ledger pointer。只有有证明的 v4/host 会话得到 boundThreadId；直接 pi 与 AI SDK 不猜线程关联。leaf:null 的 activeEntryIds 为空，供下一步优先级转换避免复活。host 只验证迁移需要的容器完整性和线程引用，不恢复或执行 reducer 状态，旧授权/任务条目仍是原始历史数据。

旧 pi schema/纯校验搬到 shared/agentLane/legacyPiSnapshot.mts，旧 IO 与新准入共用；旧 stable JSON 算法搬到 shared/legacyAgentJson.ts，避免归档 hash 的对象顺序语义漂移。词表 owner 随文件迁移、成员不变。4 组准入测试在 decoder-only 阳性对照下全部先红（/tmp/nomi-switch-integrity-red.log），新增保密错误断言；下一步仍为纯转换和来源优先级，尚未写迁移事务。

## 纯转换子任务

`laneLegacyImportPlan.mts` 对全部来源先准入，再按有证明的 v4 thread 身份压住同线程 host（含 cleared），无绑定的 AI SDK 保持独立。host 按原数组序输出 N+T；缺失工具参数与历史结果未验证事实显式保存。pi 的完整性/图结构与可执行 payload 分开：未知 payload 保留为 inert custom，旧 snapshot loader 仍要求原来的严格 payload schema。原生摘要在原 sourceIndex 追加一条旧摘要 user message；不采用 buildContextEntries 的重排结果。

工具配对按原项关联传播无效性，避免多调用消息局部降级后留下新孤儿；不排序、不补造成功、不重放权限。合成字段的零 usage 仅满足 API 形状，不是历史账单测量。三来源真实公开 append→close/reopen 测试断言 parts 与预计贡献数、顺序一致，并断言 HTTP 请求为 0；这仍不是 archive/manifest 事务或生产入口已接通的证据。

## 文件与锁子任务

`laneLegacyFiles.ts` 在捕获的目录身份内读文件：lstat + O_NOFOLLOW + fstat/路径身份、单链接与读前后 size/mtime 校验。归档用私有 partial 文件 + 不覆盖目标的 link 发布；可恢复部分写入和 link/unlink 中间断点，拒绝不同字节。移走源必须先证独立归档与源均等于预期字节；manifest 更新要求旧字节匹配。跨 await 锁采用 O_EXCL、活 PID 不抢、死 owner 回收、finally 核对 inode 再释放。App 单实例 + 主进程 admission 是跨恢复者串行前提，不声称提供任意多进程分布式锁。

4 组不安全阳性对照先红（/tmp/nomi-switch-files-red.log），8 条临时目录测试覆盖来源/目录替换、归档冲突与断点、原件变化、缺归档、异步持锁、锁替换、死 owner 恢复；不读真实项目。该层尚未接入生产迁移入口。

边界实测补充：原 private-session-snapshot-envelope 规则仅匹配字符串，误把旧格式的只读比较当 writer。保留信封声明/常量命中，排除严格相等/不等的格式检查；真实登记表正反夹具先红后绿。不新增框架债。

## 首个子任务验证

共享 decoder 与 L2 适配已实现；6 条 tmp 夹具覆盖 direct pi、context v2/v3/v4、AI SDK null/混合内容、host 跨线程与未知项、非法 UTF-8/空文件，以及三个文件入口。把旧 reader 放回做对照，同一夹具只读到 2 条会话而应为 4 条；新 reader 6/6 通过。解包不验证 checksum、不授予项目绑定信任，未接 workspace 导入、未写 lane、未搬旧文件。完整性转换、归档/前缀恢复、顶部提示仍待后续子任务。

## 公共 API 事务子任务

`laneLegacyMigration.mts` 对固定来源持有跨 await 锁与进程内 admission；先归档原字节，再经既有 SessionRepo 预留 UUID、公开 appendMessage/appendCustomEntry 回填。manifest 只保存来源 hash、目标身份与计数；重试只接续精确前缀。每次进入 verified 清理阶段前都冷开核验完整转录，completed 则不重开目标，用户后来删掉的旧对话不会复活。无凭据 import lane 只创建模型描述，不装 provider、不暴露执行方法。

23 条事务测试覆盖 append 四断点、归档/冷验/verified/五次清理断点、并发打开、源变化、新来源、归档硬链接和外来前缀。verified 恢复缺陷用原实现先红（`/tmp/nomi-switch-verified-red.log`），统一冷验后绿。现有会话/模型/收据/停止/看门狗回归 39/39。旧 cutover 已归档来源恢复与生产入口接线仍为后续子任务，不能把本事务子任务当作迁移器完整交付。

## 旧归档与桌面准入

旧 active agent-session 缺失时，只核验旧 preparation/completion 的完整绑定、hash 和同一时间戳，按确定路径读取原归档；本事务固定 archiveStamp，保留旧归档不删除。桌面 workspace 在创建工具/对用户开放前等待迁移完成，无模型凭据也可读旧对话。模型与计数契约在中立模块跨 CJS/ESM；首次续聊经公开 setActiveTools 初始化工具并写一次 metadata，以后保留已选工具组。初次无选择且无其他 lane 时选择第一条导入记录。

三来源均覆盖原字节→归档→append→冷开→零请求→本地 HTTP 续聊；host 在半个合成工具对处中断后恢复。旧归档错误证据先红，去掉首次工具初始化的编译产物阳性对照也先红；无真实内容读取和付费请求。

## 顶部提示与真实 Electron 证据

现役 v4 外壳只增加头部下方一行，legacy facts 随活动 lane 派生，未迁移的新对话不显示。中英渲染测试 2/2；真实 Electron `agent-lane-legacy-migration.walk.mjs` 通过：临时项目从旧 AI SDK 字节迁移后首开/冷开零请求，随后 1 次本地 HTTP 续聊保留旧上下文，新对话无提示。截图已逐项对账并人眼检查；原 62 张实验室基线未改。

![迁移后的旧对话顶部提示](2026-09-08-agent-lane-stage4-switch-assets/05-legacy-conversation.png)

只读聚合计数（2026-09-08）：真实项目目录 370；pi 文件 0；agent-session 文件 40 / 会话 50 / 回合 111；host 文件 17 / 会话 9 / 回合 27；三源 unreadable 均 0。没有执行真实项目迁移，没有输出真实正文；host 分区与项目目录不可按不同 source label 直接去重计项目。

整合 main 的 C0 走查后，工具引用门岗发现其仍使用旧宿主 `nomi_canvas_plan`。现役应用内分镜 owner 为 `canvasModelTools.ts` 的 `nomi_storyboard_write`，同一 propose_storyboard_plan 操作参数由共享 schema 派生；只修该测试调用者，MCP 引用门岗先红后绿，C0 夹具测试通过。不据此宣称打包 C0 已完成。
