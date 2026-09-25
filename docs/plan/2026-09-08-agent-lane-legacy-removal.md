# 第 4–5 步落地拆分（2026-09-08）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施中。

按已批准 switch 总任务书 G1–G10 清理。生产新路和迁移器均已接通；本次没有第二套运行时、provider 或转录实现。

1. 现役能力/诊断使用的 binding identity 迁到已有 shared/projectBinding；审批/工作模式词表迁到已有 capabilityApprovalPolicy，所有 import 原子指向新 owner，不留 re-export。context binding 类型就地归 shared/contracts/projectAgentContextBinding；其旧 reader 仍用于格式证据。G5 receipt 类型从现有 receipt service/transport 派生。
2. 删旧宿主消费者与旧 renderer 客户端/投影；旧 agentChatV2 facade、contextService/Store/Host/Paths/legacyBubbles 的执行链一并退役。保留仍活的 prompt/skill/input/能力定义；RuntimeUsage 等指向既有 transport owner。
3. 旧 runtime 单测由现役 lane 的 session/durability/stream/error/budget/approval/native/coding/context/legacy 试验承接；旧 facade/store/client tests 随死实现退役。receipt、shared-binding、能力 adapter 活测试保留。基于真实旧运行输出 /tmp/nomi-switch-old-parity-control.json 固化只含合成语料的控制夹具，lane-shadow-parity 保留节拍/文本/用量/最终文稿四项；19 剧本 L1 仍单独跑，不能把录制控制叫实时双跑。
4. 先退役消费者（包括目录内部依赖旧 host 入口的文件），保存用户指定 git grep 零输出，再移除旧 host/runtime 目录剩余文件。另以完整 import/dynamic import 扫描补足单行 grep。
5. framework 14 债归零，at/owner/词表/文件大小/边界登记同步；不提高基线，不改冻结图片。编译测试前清理本 worktree .tmp/agent-runtime-tests，避免删除源码后旧编译产物继续参与测试造成假绿。
6. 验证合成数据迁移与续聊、G5/安全/凭据/会话隔离/冷开、全 gates 与真实旅程。总 diff 大于 120KB 时按已验证文件组分笔 commit，push 仅任务分支。

回滚：git revert 对应 merge；按 migration manifest hash 恢复旧原路径，任何现存不同字节停止；新 lane 保留隔离。不改其他 worktree、不读真实库正文、不调用付费模型。

## 先查别人

本次执行已批准切换方案的删除阶段，不引入新框架或能力；沿用 [阶段 4 勘察与承接表](2026-09-08-agent-lane-stage4-switch.md) 和 [旧对话迁移方案](2026-09-08-agent-lane-legacy-migration.md) 的先查别人结果。

- 依赖已有：pi 0.85.1 AgentHarness 的公开 session、append 与 steering API，规范 https://github.com/earendil-works/pi/tree/main/packages/agent-core 。
- 仓库已有：electron/agentLane/laneHost.mts:17、electron/shared/projectBinding.ts:1、electron/shared/agentCapabilities/capabilityApprovalPolicy.ts:1；本次删除旧 owner，全部调用者指向这些现有层。
- 生态：https://github.com/earendil-works/pi 。用户材料沿用上面已批准方案，不为删除另造替代实现。
结论：用已有；保留合成旧执行控制作为数据夹具，不把旧运行时搬进 tests。


## 删旧时发现的网络承接缺口

真实 Electron proxy-cold 夹具证明 lane 单次模型调用未经过 appFetch：前一条 AI SDK 请求成功穿代理，新 lane 的请求计数不增且返回 Connection error。两种入口 openLane / runLaneSingleShot 都汇入 createNomiProvider；把 fetch 变为必填装配依赖，桌面传现有 appFetch，Node 合成夹具显式传 globalThis.fetch。禁止可选依赖或全球代理补丁。安装 pi StreamOptions 已提供 fetch；只绑定现有公开字段，不自建传输或更改重试。

出站登记从已删除的 context/agentContextHost 迁到 laneDesktopRuntime，同一用户配置的模型端点，不增加裸出口数量；不放宽目的地规则。

## 实测证据

- 删前 import 扫描为零：`git grep -nE '^import .*(harness/runtime|projectAgentHost)' -- electron src tests`，退出1/空输出；之后删目录。
- 冷编译现役 agent-runtime 368/368；L1 19剧本、76判据、冷开19/19；R30首调8/8、回合8/8、审批8/8。四项旧控制按删前真实合成执行结果比对。
- 网络阳性对照：未注入 fetch 时三次复现请求未发出；修后真实 Electron 43.4.1 三协议×single/persistent 全过，19次本地请求、0付费。代理夹具按URL pathname识别 Anthropic 的 beta 查询参数，避免把401误回200。
- framework pi 债条目13条、命中15处全部清零（任务书的14为早期计数）；仅保留无关 xyflow 债1条。framework at没有已删除路径；旧scope留作防重新引入门岗。词表只删旧owner，cap随债下降；边界77保持，巨壳白名单移除旧state并收紧已瘦main/Studio。
