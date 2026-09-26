# 原分镜保存适配最小修复（方案待 root 复核）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

范围：简化 A K4，F02/F03/F04/F05 与内容CAS。只接现有Run保存对象，原editor/rowActions/canvas runner由root负责。禁止全T3、新编辑页面、第二可写plan、复制runner。当前阶段仅读代码、门表和红测。

## 规则回读与事实

已读AGENTS、根因skill/template、用户Sep20简化A+T7方案、Sep20全审报告。P1保存owner唯一；P2跨单/多候选及状态修最早转换/提交边界；P3受控测试不是真实旅途；P4模型身份交原resolver不加厂商词表；R4先方案；R21机器门图；用户当前范围高于旧T3指令。

真实owner：`ProductionRunRepository`持久Run；当前作者字段分散在 `generationPlan.candidate/shots[].candidate + editorial`，title在authoring.title。现适配互斥字段设计可保留，不新增authoring.plan。原 sealed contract/envelope/jobs 是执行事实；事件日志保存历史合同。原B store仍只服务已有legacy方案，新Run绝不复制回B。

门表：`/private/tmp/nomi-save-doors.txt`（15门，2写13读）；`/private/tmp/nomi-save-authoring-doors.txt`（3写）。repository实际CAS另由共享owner协调。

## 四项可独立修复

1. F03：prior map纳入single candidateId/nodeId；同稳定身份保留references、node绑定、detached及结果执行历史。纯标题/重排不丢字段。不要把single改成新身份。
2. F04：改变模型/供应商/模式时不携带旧transportModelId/variant/module/taskKind。由原目录解析选中身份；未加载时保留已知作者选项，不清选择或换默认。适配不能自行猜model名称。原runner已消费modelKey/vendor/modeId，执行身份必须由既有resolver重建。
3. F05：作者保存不修改已sealed contracts/envelope/jobs，也不把submitted强制退draft。仅更新可编辑candidate/editorial/title；新付款请求仍经既有present/授权重建快照。必须审所有执行读取处是否只读contract，验证正在跑的job晚回不覆盖新作者内容。若任何路径仍读current candidate作执行事实，先纠正该读取，不开新快照库。
4. F02：Agent当前 `draftShotSchema`只有role anchor，没有kind/carrier、anchorIds/keyframe等完整事实。不能把所有anchor猜成character。新创建入口应复用原共享 `PlanAnchor/PlanShot`字段schema作最小可选editorial事实，将字段一次性写入同generationPlan editorial；不新建Agent工具。旧anchor缺语义：需准确兼容策略，至少可看原name/prompt/model/refs但不得无提示伪造kind或生成语义。此点需要root裁定现入口如何传完整Plan事实；当前四项红测中的“旧anchor能打开”只锁结果，不授权编造字段。

## 内容 CAS 建议（repository共享文件未改）

在保存命令上携带 `expectedContentToken`，token由host对仅作者字段规范化生成（candidate prompt/model/vendor/mode/parameters/references、editorial、title、稳定subject集合），排除job/status、nodeId、canvasDetached、included/payment scope、run.revision、timestamps、候选流水revision等执行字段。读投影返回token。

repository实际execute边界对 `generation.save_storyboard` 比对token，再在同一同步提交段执行；其余命令仍用原expectedRevision。不要在renderer读最新revision重发，不放宽一般CAS。旧客户端无token不能绕过：继续原严格revision或显式拒绝取决于当前IPC版本部署策略，不能默默last-write-wins。真正作者改动即使run.revision相同也须冲突；仅job/binding变化不冲突。

提交边界必须原子；只在service预验token随后await再repo.execute不成立。K3代理/root拥有repository文件，我提供纯content token/check函数及save schema，交其接窄分支。

## 预计生产范围与协调

核心5文件：generationPlanEditorial.ts、productionStoryboardAuthoring.ts、productionRunTypes.ts、productionRunProjections.ts（或现read projection owner）、useStoryboardRunHost.ts（只保存读适配；root独占其动作段需协调）。共享2文件：productionRunRepository.ts、productionRunIpc.ts（由owner接窄CAS/schema）。Agent完整事实至少需draftShotSchema所在writeVerbs.ts、既有生成输入schema/transport producer，可能总计9–10文件；如果不能在已触及producer中完整表达，将先报告不靠类型cast跨过协议。不改editor/rowActions/appIntegration、不增新compiler。

## 红测与验收

新增 `electron/productionRun/storyboardSaveAcceptance.test.ts` 四项真实转换/保存函数用例，全部确定性失败：single refs/binding丢失、换模型残留task identity、Agent anchor读取抛错、submitted编辑抛错。日志 `/private/tmp/nomi-save-acceptance-red.log`。未改生产。

CAS红测待root确认具体token接口后用真实repository执行：读取编辑内容→bind/job状态推进→保存应成功；读取→另一个作者保存→旧保存应冲突且保持本地草稿。不要用缺符号编译失败当红测。

最终需两文稿四方案全字段保存/重开、Agent含anchor、单/多候选、模型切换、submitted期间编辑+晚结果、完整引用/首帧/结果往返；受控绿后由root合并原runner真实Electron旅途。不承诺Windows/真实供应商已验。

## root复核后的职责修订（取代上文F05建议）

反证：`productionGenerationAuthorizationState.ts:163/288/448`校验当前candidate.revision，不能在submitted上改candidate还声称执行仅看contract。上文“保存仅替candidate保state”作废。

root提出并负责裁决最小完整边界：复用 `generationPlan.editorial` 直接存完整原 `StoryboardPlan`，此字段是新Run唯一作者正文；candidate/contract继续作为已有执行/待确认事实。它不是第二个同职责可写plan，也不新增authoring.plan/DB/迁移器。保存不改candidate，所以submitted继续编辑不碰已批准执行。

必须同时改Agent真入口：当前 `draftShotsProjection → generation.plan.patch → mcpGenerationTools → operations.patch → generation.patch` 改candidate。拥有editorial的文稿Run，其Agent作者patch必须写同一editorial正文；付款 `generation.revise` 仍只改请求对象，不反向回写作者正文。Create原子初始化editorial，不能每次read靠candidate重建，也不能双向同步effect。原Runner从editorial单向产生显式执行输入。

旧无editorial：只读投影作为旧格式来源；首次显式用户/Agent编辑保存原完整plan后，所有后续读只认editorial。旧anchor缺kind/carrier的事实不能猜，新draft_shots扩原shape的kind/carrier等作者字段复用共享schema，producer一并保留。旧缺失项显示可读原字段并明确缺失编辑语义，不能作为全新Agent输出的常态。

内容token在此方案只规范化完整editorial（旧无editorial为旧候选作者投影），不掺执行quote/job/node bindings。作者保存使旧待确认请求失效应通过既有请求身份/quote绑定token实施；执行中合同不受影响。该关联须与付款代理协调，不能因candidate未变就允许旧请求批准。

预算：本代理生产8–10文件（shared editorial适配；authoring save；types；generationPlanSchemas；verbs/writeVerbs；verbs/draftShotsProjection；multiShot producer；operationStore作者patch；token读投影若必要）。repository原子CAS由K3 owner/root独占，editor/service/appIntegration由root独占；修改operationStore需与付款代理划分patch/create与revise代码。不再加compiler。超10则先报告原因。

当前确定安全实改仅 generationPlanEditorial.ts 的single prior保留/旧身份失效及content token；F03/F04+token四项通过，F02/F05仍明确红。根因合同扩既有core-storyboard-write-ownership，未新起同层重复合同。

### 接线收尾（2026-09-20）

作者正文只存在 `generationPlan.editorial: StoryboardPlan`；候选及合同是执行快照，不做作者反向同步。保存走原 Run command，内容 CAS 排除执行进度；未批准报价随编辑撤销。已有执行合同/授权/作业保持不变。

Agent 继续用原 `draft_shots`。新增可选瞬时 `storyboard` 字段复用原 anchor/shot schema；完整作者字段与顶层语义冲突时拒绝。sourceDocument 创建种同一 editorial，patch 调原 save command。reference URL 复用项目资产索引。旧 anchor 只有 role 而没有 kind/carrier 时无法无损恢复，明确拒绝猜测；新入口必须提供原事实。本项旧数据兼容仍需产品裁定，不能称 F02 全部解决。

editorial present 复用 requestRendererDecision 到原 renderer runner；精确 scope 和 content token 贯通，返回 presented 只证明原确认路径已完成响应，不称已支付。preview/gate 不再给旧候选报价。新增接线文件均是现有层：writeVerbs/schema/projection保留作者输入，mcpMultiShot只做创建适配与bridge（不执行编译），mcpTools路由，operationStore/service/repository贯通已有持久化。未新增数据库、服务、工具、执行器或同步版本。

### 镜头交给 Agent：恢复原入口的稳定寻址

已复现：原行选择只写行号 chip，发送不消费它；跨 Run 或排序后可指错镜。沿已有 reference.value 用 JSON 编码 documentId/runId/stable shotId，不新增状态。发送同步截取 refs，只给选定 Run 匹配的 stable shotIds；旧行号引用不套新 Run，新建不继承。现 StoryboardRequestTarget 加可选 shotIds，已有schema/formatter/transport共同约束 patch/present。文件限定 residentReferences、原Editor两调用、useAgentPanelV4Actions、generationInvocationContext、laneDesktopInput、generationTransportAdapters及对应测试；无新工具/owner。

## 先查别人：原保存与执行 owner


- 原执行已有：`src/workbench/creation/storyboard/exec/storyboardRowActions.ts:173`、`:230`、`:315` 分别负责单镜、变体和批量；本次输入适配必须调用这些入口，禁止替代 runner。
- 原投影已有：`src/workbench/creation/storyboard/exec/storyboardProjection.ts:73` 统一处理已绑定节点与画布覆写；保存只接该 owner，不添加并行同步器。
- 原持久化已有：`electron/productionRun/productionRunRepository.ts:409` 是保存命令实际提交点；内容 CAS 在此校验，不在 renderer 盲读新版本重试。
- 依赖提供状态机制：`node_modules/zustand/middleware.d.ts:3`/`:5` 导出 subscribeWithSelector/persist，但不能替代现有项目 Run 的磁盘事务与目标身份；不引入第二持久化库。本轮复用已安装库与原 API，不新增框架能力或外部服务。
- 反方证据：[完整审查 F01/F03/F05](../audit/2026-09-20-core-a-full-review.md) 已证明复用 JSX 却替换动作、双写作者/执行候选会丢原功能和字段。因此选择原 owner 最小接线；外部新框架并不能修复本地目标归属，未声称本轮新增外部检索。
