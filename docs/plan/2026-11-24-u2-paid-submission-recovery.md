# U-2 扣了钱能找回

负责人 u2-receipt-impl。范围为花钱、长跑、可打断、数据格式。

## ★0 先查别人

- Stripe API v1 把首次执行结果绑定到幂等键。上游是否实现这项能力各不相同，因此 Nomi 重新观察同一意图时只读收据。[Stripe API](https://docs.stripe.com/api/idempotent_requests)
- AWS 的 outbox 指出业务写与通知的双写窗口。先写 Run 持有的受理事实，再通知调用方，重开可凭事实补投影。[Transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- ComfyUI 把入队和按编号读取历史分成两个端点。保存首次响应里的 prompt_id，恢复走原服务的 history。[Server routes](https://docs.comfy.org/development/comfyui-server/comms_routes)

出口：[Stripe 重试语义](https://docs.stripe.com/api/idempotent_requests) · 同一意图重读原结果，新意图另立标识 · 原单有凭据就续查，结果未知由创作者核对并明确重试。

## ★1 创作者的结果

创作者在画布选模型、点生成、关窗、换默认模型、重开项目，应该能把原单的图片或视频拿回来。分镜批次中的每一镜单独恢复。量具为 paidSubmissionRecovery.integration.test.ts 的生成 POST 计数、原任务的查询目标和项目中的产物。目标为每次明确生成各一单、所有恢复零新单。任务中心、节点和 Agent 使用现有结果未知与手动重新生成动作。升级前可读的任务号和已落产物继续可读；缺少原始同步响应的历史单无法补造。

## ★2 状态主人

门表由 door-map 对 runTask、executeProfileOperation、runCustomCallTask、fetchTaskResult、两种 provider 工厂和 Run 提交出口生成，初扫 63 扇门；随后补查渲染层账本选择、费用判据、锁、状态转移、受理与取回；按同组符号复扫，基线 119 扇，修后 144 扇。完整输出在同名根因合同。画布单镜、批量、分镜、Agent 和 MCP 通过各自适配器进入 Run。出网步骤提供原始答复，Run 记录受理时间、任务和执行身份，观察者负责到终态。

## ★3 路线选择

既有断线规范见 2026-10-02-paid-submit-no-blind-resend。延长内存缓存仍跨不过重启。删除重试只解决重复扣款。选择把创建响应接进现有 Run 信封，并以冻结的查询参数续查。

## ★4 全状态

尚未派发可取消。发送中显示运行中。获得编号可续查，直接媒体可重新取回。已落产物返回成功，部分落地补剩余产物。未知显示结果待核对，明确重新生成分配新单。本机提前拒绝显示未发出。原连接不可用保留原单供稍后取回。取消中继续观察已经派发的镜头。

## 5 中途表

|耐久事实|停、关窗或重启|断网|连点|
|---|---|---|---|
|确定未发送|原单未发|保留本机错误|显式新意图才可发|
|发送中，无受理答复|失主后转结果未知，留预留账|保留未知与核对入口|同意图零追加提交|
|收到任务号|原任务续查|保留查询身份|读同一单|
|同步媒体已应答|从收据落地|地址暂时不可达可再取|复用收据|
|产物就绪|打开项目产物|本地读取|本地读取|

## 6 外部数据与失败

2xx 逻辑拒绝沿用供应商错误判据。响应只到一半、读不出编号又没有结果凭据的请求保留不确定性。凭据沿用连接的授权边界，恢复不把新连接的凭据发送给原地址。

## 7 性能

沿用同一生成、重试和取回交互。最坏情况是同步 base64 响应，写盘在确认受理的关键路径上。持久化时延与大响应内存峰值未验证，缺少该负载的基准。

## 8 真实条件

验证使用本地故障注入，按实际生成 POST、查询和落地计数。真实付费、Windows、真上游留存时间与真实断电均 unverified。现有画布和错误状态承载此逻辑修复。

## ★9 验收与回滚

独立验收以磁盘重开后能读回原单结果为准。异步回执、同步媒体、ComfyUI 和自定义脚本的首次提交各 1，恢复 0。已写 socket 无响应必须显示未知，人工新单后累计 2。切换默认连接后查询仍到原服务。局部下载失败不得抹掉已受理；完全拦下不能产出结果。回滚使用本次修复提交的 git revert，保留项目内已写记录。[独立故障验证报告](2026-11-24-u2-paid-submission-recovery-verification.md)。

## 系统改进与 NF-1104-0001

最早漏在提交验收。旧的 productionGenerationSubmission.test.ts 甚至要求“受理后中断”转成结果未知；验收没有在第一次响应与第一次下载之间重开项目取片。如今 paidSubmissionRecovery.integration.test.ts 在这个窗口复制真实 Run 文件，重建服务后核对原单字节和实际 POST 数。ComfyUI 编号和同步图片是两条独立的正例，写出后无响应和本机拒绝是反例。2026-12-08 用同一套件复查；恢复产生新 POST 或无法取回夹具原件即重开。

NF-1104-0001 在指定基线、可达的 docs 和 tests 历史中无工单正文。与任务描述相符的两条路径分别在 `electron/catalog/customCallDispatch.ts` 和 `electron/runtime.ts` 写入收据，`electron/tasks/acceptedTaskResult.ts` 负责只读取回。独立报告的 ComfyUI、声明 query 的脚本和独立脚本三例给出了文件及 POST 计数。仓库内没有可改为关闭的原始工单。

本地运行的补测还覆盖同步音频落地失败、目录接口直接返回媒体并同时给出响应 ID，以及对项目中已保存取回指令的签名校验。认证连接的原凭据不可用时，保留原单并指示稍后取回。任意脚本若没有声明可识别的任务号，且恢复需要另一次有副作用的调用，只能人工核对。
