# 功能与接口实现合同
本文件是拟实施合同，不是现有 API 实现。官方资料核对日期：2026-11-03。所有新增 DTO/缓存策略均为设计决定；现有函数名只在确实存在时引用。

## 公共边界
- 凭据：主进程从既有 connectionId 解析，不从 renderer 每次带明文 Key。远端请求必须复用现有出站/端点绑定规则；不得把一个 Key 发往未授权域。
- 新只读账户查询按 connectionId + credentialRevision + endpointRevision 缓存。修改 Key、地址、撤销连接时清理；晚到响应先比 revision，再投影。
- 请求组每项独立状态：idle / loading / ready / stale / failed；认证成功不要求所有辅助接口都成功。数据未知为 null/unknown，不是 0；金额单位必须明确。
- 建议账户快照最小投影：accountRemaining、accountUsed、keyRemaining、keyUsed、keyUnlimited、unit、observedAt、connectionRevision、各字段状态。只有已知单位相同才比较限额，不硬编码 Credits 与货币换算率。
- 新账户 IPC 的名字由实现按现有命名规范确定；必须为只读、验证 renderer sender、以 connectionId 为参数，响应只给可显示事实及脱敏错误，不能暴露凭据或原始响应。
- GET 并发上限 3；用户动作立即显示检查状态；单次 10 秒超时作为客户端建议，可重试。余额缓存 30 秒，重新获得焦点时对超过 30 秒的快照刷新一次；用量遵守官方至少 60 秒间隔。两者失败保留旧快照并显示时间。
- schema/category 缓存按 Key/组相关连接隔离，5 分钟为建议客户端 TTL，模型选择才取详细 schema；未知模式需人工映射/准入，不自动上线。
- 所有 paid POST 仍走现有 Run/spend 授权。预览里“演示确认”不是新增产品付费入口。

## F01 一次 Key 接入 → S02/S03/S04/S05
**接口：** GET /v1/balance；GET /v1/models?expand=category。可并行 GET /v1/user/balance，不把资金查询失败等同认证失败。
**响应关键字段：** balance 的 remain_balance / remain_credits / unlimited_quota；模型 data[] 的 id、分类与能力信息。以正文契约和实际响应校验，不要求字段名中包含“成功”就通过。
**操作：** 默认输入候选 Key→只读认证/目录→保存走既有 credential 路径→刷新当前可用模型→关闭设置回原稿。**保留未验证保存：** 新增连接遇到网络故障或用户主动选择稍后检查时，可明确点击“先保存，稍后检查”，沿既有 verificationPending 保存；重开显示“已保存，待检查”，使用已存凭据重试，不要求再次去官网复制。此状态不能显示可生成或覆盖旧连接。更换已有连接Key则保持候选暂存，验证失败不替换旧Key；关闭未保存候选即清除。仅对明确 401/403 做身份/权限错误；网络或格式异常单独提示。
**部分成功：** Key 通过但余额暂缺可继续；目录无匹配模型则显示“连接正常，当前任务没有已适配模型”，提供改任务/其他连接/诊断，不称 Key 错误。
**owner：** apimartVendor / directKeyCredential / onboarding model-list / 原 OnboardingDrawer 保存回调。不能把单次自检写成永久 verified generation。
**验收：** GET-only、空列表、目录不可达、Key错误、快速更换 Key 的旧返回、旧连接不被覆盖、关闭后原稿保留。
来源：[余额](https://docs.apimart.ai/en/api-reference/account/token-balance)、[模型](https://docs.apimart.ai/en/api-reference/texts/models/list)。

## F02 账户余额与 Key 限额 → S06/S17
**接口：** GET /v1/user/balance；GET /v1/balance。
**响应：** account remain_balance/remain_credits/used_balance/used_credits；Key 同类额度与 unlimited_quota。unlimited + -1 仅表示 Key 不限额，账户资金仍有限。
**UI：** 账户资金、本 Key可用额度、更新时间分别显示；Key 限额不足引导官方 Key 管理，账户资金不足才引导充值。两者未知时显示查询失败/上次记录，不填0。
**充值：** 官方浏览器付款；切回只刷新资金。不能根据余额增加认定某订单完成、某邮箱关联或邀请绑定。网络原因未查明不诱导充值；待到账优先核对原订单。
**owner：** 新账户事实放主进程连接读取边界，设置投影，不写 Model.pricing。
**验收：** account=0/key unlimited、account>0/key=0、两者null、单位缺失、充值回来不提交、浏览器账户可能不同。
来源：[账户余额](https://docs.apimart.ai/en/api-reference/account/user-balance)。

## F03 模型发现与参数 → S07/S08
**接口：** GET /v1/models?expand=category；GET /v1/models/{id}/schema；有斜线 ID 用 GET /v1/model-schema?model=…；批量取参数可用 expand=parameters&category=video。
**决策：** 推荐目录 = 当前 Key可见 ∩ Nomi 已准入模式 ∩ 当前任务能力。官方 schema 不能静默覆盖用户手工参数/启停/自定义契约。仅展示名/分类/描述可更新来源受管元数据；输入槽、必填参数、枚举删除、默认值/模式/计价变更必须形成候选版本并重走准入。用户修改过的契约不自动写入，保留当前版本并提示差异；明确与上游必需约束冲突的具体模式暂不可新提交，提供切换已知模式/模型详情修正，其余模式和旧任务查询不受影响。无明确冲突、仅metadata过期时继续原已准入模式并标更新待确认。平台新增模型只成为候选，不自动宣称可用。查询失败保持本地已适配目录并标可用性待确认，不能删除用户模型。
**限制：** 参数 schema 目前主要覆盖图像/视频，动态组合可能缺失；unknown 分类不等于不可用；全量 schema 可较大，按需取。
**owner：** catalog/archetype + modelAdmissionSchema；只转允许的参数类型/枚举/边界到已有控件，禁远端脚本/表达式，数值/URL/素材约束在主进程再验。
**变更：** 保留模型、模式、schema版本指纹；报价与授权后若相关规格发生变化，要求重新确认，而非偷偷改模型。
**验收：** Key受限目录、无 schema、未知分类、ID含斜线、分辨率×时长冲突、恶意超大 schema、旧任务身份不随目录更新改变。
来源：[模型 metadata](https://docs.apimart.ai/en/api-reference/texts/models/list)。

## F04 价格与预扣 → S09/S13/S14/S15/S16
**接口：** GET /api/pricing/model?model=…（公开价，不必带 Key）。模型ID和报价身份必须精确到渠道/模式。
**响应适配：** TokenPricingV2 读 data.pricing.effective_rates（已折扣）；tools 按契约应用 price_factor。图片/视频可能返回 paid_price、resolution_paid_prices、billing_type，必须对应已知单位，不靠字段名猜。
**拟扩展共享报价投影：** estimate/range/unknown、unit、quantity、specFingerprint、sourceUrl、observedAt、scope(public/account)、includedItems、excludedItems、knownPreauthorizationUpperBound。这组概念进入现有 deriveShotPrice owner，具体类型名不固定。
**报价策略：** 5 分钟客户端缓存；编辑影响费用的模型/渠道/时长/分辨率/数量/参考素材会作废旧估价。没有已知、有效、规格匹配的费率时，默认推荐付费路径不自动提交；提供刷新、官方价格、换已知报价模式/已有高级流程。不能用上次另一个模式的价格补零。
**展示：** 预估≠预扣≠最终费用。首次默认链中公开价明确“参考”，不声称账户专属；存在已知预扣上限时与估价一起呈现。缺乏可靠报价的高级路径沿现有显式费用确认语义，不新增静默绕过。
**比较/活动：** 只比较同模型、渠道能力与计费单位；活动要来源/期限/资格，过期撤下。邀请码不是优惠码。
**验收：** 普通与official不同费制、零与缺失、工具折扣仅一次、阶梯整体输入选档、价格过期、切规格、账户分组差异、预扣高于估价。
来源：[价格契约](https://docs.apimart.ai/en/api-reference/texts/qwen3.8-max/pricing)。

## F05 等待、恢复与逐模式幂等 → S10/S11
**接口：** GET /v1/tasks/{id}?language=zh；音乐 GET /v1/music/tasks/{id}；Midjourney 原动作可查询专用状态。
**响应：** pending/processing/completed/failed/cancelled、progress、estimated_time、result、error、cost、credits_cost；家族专用状态需映射，未知枚举留待核对，不能当失败重发。
**恢复顺序：** 有 taskId→原查询；服务端成功下载失败→原结果落地；无 taskId 但有明确幂等契约→复用原键+相同请求；无契约→indeterminate，用户核对原调用记录，不自动换新请求。
**幂等：** Grok Imagine 2.0 Ext 等明确支持 Idempotency-Key。只在具体 model+operation 的准入声明中开启，不把 provider 全局 false 改成 true。持久保存用户此次确认的请求指纹/键/版本与授权记录；网络重试不能重新生成键或改正文。
**409：** in_progress 按 Retry-After等待；key_reused 表示键体不匹配停止；result_indeterminate 停止自动重提。保留期以该模式合同为准，超过保留期不假设仍可防重。
**owner：** 现有 GenerationProvider / Run 身份与提交门 / taskResultQuery / productionRetrievalReopen；扩能力粒度需要同时修改所有读取 submitIdempotency 的调用者和测试，禁止只加 HTTP header。
**验收：** 超时前/后写出、任务ID丢失、重启、连点、相同键不同体、未知枚举、部分结果、下载失败、无取消接口时不承诺远程取消。
来源：[任务状态](https://docs.apimart.ai/en/api-reference/tasks/status)、[Grok幂等](https://docs.apimart.ai/en/api-reference/images/grok-imagine-2.0-ext/generation)。

## F06 上传、复用与链接过期 → S07/S11/S14–S16
**接口：** POST /v1/uploads/images，multipart file；响应 url、content_type、bytes 等。图片上限20MB，文档保留72h。
**本地规则：** 原件一直归项目；类型/大小先验；按实际目标模型的分辨率/时长/Alpha约束再验。上传缓存放现有素材边界，键至少包含 connectionRevision、内容指纹、mediaKind 与运输目的地；临时URL不进日志/分析。
**已有基础：** 单请求去重、原始URL探活复用、返工引用、轮询不上传、原子保存全部复用。不重新写下载器。
**未解依赖：** 音视频字节通用直传未确认；Flow Music uploadAudioFlowMusic 接收公网audio_url换clip_id，不解决本地托管。先沿既有可用上传方式且明确目的地；无可用运输时保留草稿，提示配置合适上传连接/换素材，不自动传未经用户选择的匿名图床。
**验收：** 相同内容复用、改文件/改连接后不复用、72h过期、本地原件丢失、下载链接过期、参考视频不能被图片上传器吞掉。
来源：[图片上传](https://docs.apimart.ai/en/api-reference/uploads/images)、[音频导入](https://docs.apimart.ai/en/api-reference/audios/flow-music/upload-audio)。

## F07 单任务费用与平台用量 → S12/S17
**接口：** task结果 cost/credits_cost；GET /v1/usage?start=…&end=…&group_by=date&tz=…&scope=key（scope 仅 key/account；model 是独立可选筛选参数；group_by 仅 none/model/date/model,date）。
**限制：** 最长31天，最多50模型，同参数缓存60秒，最近一分钟可不完整。聚合结果不是项目账单；不从账户余额差额推某镜头花费。logs/export 虽被提及但契约不全，不依赖。
**UI：** 节点沿原provenance展示实际费；设置显示“此 Key 用量”/“账户用量”，切换范围注明其他工具消费也可能计入。未知最终费用显示待结算/未知，不造0；部分交付按实际收据。
**owner：** vendor/cost → taskResultQuery → ProvenancePanel；账户聚合数据独立读取，不新增任务账本。
**验收：** 多应用同时消费、Key/account切换、0/缺字段、部分退款、延迟统计、31天越界。
来源：[用量](https://docs.apimart.ai/en/api-reference/account/usage)。

## F08 H3 源任务生成2K → S13
**接口：** POST /v1/videos/generations，model=MiniMax-H3-Regeneration、source_task_id；沿现有映射查询任务。
**资格：** 同账号完成的H3 768P源任务，条件符合官方合同；不能把本地任意视频当H3源。账户身份无公开字段时，不靠本地同connectionId证明相同平台账户；结合源任务凭据绑定和查询，服务端拒绝时保留源。
**操作：** 结果菜单“准备2K版本”→派生草稿自动带源ID→显示继承内容、2K与费用→明确确认→新节点/版本。源任务不可用时说明原因并可保留原结果、返回原稿，不要求用户手抄ID。
**owner：** 已有 minimaxH3Regeneration / apimartVideos，加结果上下文动作，不做通用超分器。
**验收：** 非H3/非768P/未完成/不同凭据/源过期/重复准备/费用变化；准备动作不发paid POST。
来源：[H3 regeneration](https://docs.apimart.ai/en/api-reference/videos/minimax-h3/regeneration)。

## F09 蒙版局部改图 → S14
**首条落地路线：** GPT-Image-2 official：POST /v1/images/generations，model=gpt-image-2-official、prompt、image_urls、mask_url 与所选 size/resolution/quality/output_format/n；默认草稿 n=1、output_format=png，费用相关规格可见。不得使用普通渠道ID代替。
**选区：** 编辑在图片原有宿主；坐标由显示缩放/留白映射到原图；导出与第一张参考图同尺寸的Alpha蒙版，按模型语义确定透明/保留区域。保存原图、选区和编辑描述，生成新派生图。
**后续路线：** Grok segment / region_edit 同路径不同 operation。segment结果是image_id/objects/RLE，不是普通图片；外部图cache_only未命中不能显示“可免费分层”。region_edit使用同一image_id与选区身份，之后更新身份。
**UI：** 原图 + 可见选区 + 修改描述 + 模型/规格/费用；无选区、尺寸不符、Alpha丢失、无对应模型有明确修正入口。按选区编辑不保证区域外像素绝对不变，文案不做此承诺。
**验收：** 横竖图、非1:1缩放、留白、透明格式、第一参考图匹配、无选区、cache miss、撤销/重做选区、原图不覆盖。
来源：[GPT official](https://docs.apimart.ai/en/api-reference/images/gpt-image-2/official)、[Grok区域编辑](https://docs.apimart.ai/en/api-reference/images/grok-imagine-2.0-ext/layer-region-edit)。

## F10 原视频编辑/续拍 → S15
**第一条路线：** Seedance 2.5，POST /v1/videos/generations；model=seedance-2.5，omni_reference_task_type=edit/extend，video_urls与可选参考，prompt、size、duration依模式绑定。
**编辑约束：** size=adaptive，duration=-1，源4–30秒；省略编辑duration也归一到-1，可能按30秒输出预扣后结算。续拍需源视频与adaptive，具体长度按该模式合同。上游仍按prompt分类，omni_reference_task_type不是绝对保证。
**操作：** 选择源结果→修改/续拍→原视频范围可见→用户描述→检查可用上传→显示估价和已知预扣→确认。不得暗自加“编辑/续拍”提示词；需要时提示用户可见修改。
**素材准入：** 官方要求真实人脸使用审核通过的素材库 asset:// 引用，不能把原始人脸公网URL直接提交。该输入需补齐同家族素材库的导入/审核/状态/引用链；这不等于已取得通用音视频字节上传能力。I6 首版若未交付此链，就对真实人脸素材明确阻断并保留草稿；不得以换渠道绕过。
**结果：** 新版本带源关系，不覆盖原片。模式不符/源长不符/运输不可用就原地修正。若预扣未知，说明未知并保持显式费用确认。
**验收：** 4/30边界、source缺失、adaptive要求、显式不合规duration、预扣高于最终费用、类型不符、音视频上传未配置。
来源：[Seedance2.5](https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation)。

## F11 音乐后处理 → S16
**先做一条家族路线：** Flow Music，POST /v1/music/generations/{extendFlowMusic|replaceFlowMusic|stemsFlowMusic}；model=flowmusic、clip_id；续写还必填 extend_from_s、extend_s、instruction，替换必填 start_s、end_s、instruction，分轨只需 model/clip_id。区间满足 0≤start_s<end_s≤源时长；续写起点在源时长内、0<extend_s≤164秒。源clip_id从该家族结果取，绝不拿Suno task_id充当。
**导入：** 外部音频先得到可用公网URL，再uploadAudioFlowMusic异步换result.music[0].clip_id，等导入成功后准备后处理；导入自身是否计费按实际契约确认，不自动触发。
**UI：** 音频节点菜单选择延长、替换区间或分离音轨；显示源音频与区间/模式，估价后确认；结果保存为派生音频，拆分音轨保留对应名称与原来源。
**结果合同：** 续写/替换返回新的 result.music[].clip_id，后续操作用新ID；替换输出是整首重渲染的歌曲，不直接将返回文件当成所选区间。分轨返回 result.music[0].file_url（application/zip），不是两个直接音频URL。分轨交付链新增归档结果适配：模型mapping识别file_url+application/zip，在现有任务物化边界分派归档处理，不能交给普通音频解析器。下载复用 fetchProviderMedia；将原ZIP作为Run内部任务产物暂存，不把ZIP当可播放媒体节点。使用已安装fflate的异步/流式解包能力，后台处理；提案客户端限制：压缩包≤64MiB、解包总量≤512MiB、≤32条目，超限保留原包并提供另存/人工导入，不自动放宽。拒绝绝对路径、..跳出、链接、重复冲突条目和未知嵌套归档；输出用生成文件名，不信任归档路径。按媒体魔数/现有探测器校验可播放音频后，经 projectAssetStore 原子发布为独立音轨，记录 taskId+源clip_id+条目指纹防重复导入。
**分轨中间态：** 平台已完成→音轨包下载中→音轨导入中→完成/部分导入/导入失败。失败时保留已成功音轨与原ZIP，按钮为“重试导入原音轨包”或“另存原包”，仅重下/解包/导入，不再次调用分轨POST；新一轮分轨需重新确认。自动解包未通过安全/媒体测试前，该模式不进入新手推荐。
**后续：** Suno需task_id+audio_index等自身身份；alignedLyrics不是普通语音转写，已有Whisper→SRT继续保留。普通裁剪/淡出优先本地媒体链，不多调用远端。
**验收：** family错误、clipId缺失、外部导入失败、替换区间越界、部分音轨、费用未知、原音频保留。
来源：[Flow延长](https://docs.apimart.ai/en/api-reference/audios/flow-music/extend)、[替换](https://docs.apimart.ai/en/api-reference/audios/flow-music/replace)、[分轨](https://docs.apimart.ai/en/api-reference/audios/flow-music/stems)。

## F12 原有连接管理 → S18
不新增外部API。继续允许新建其他平台和本地连接，收在高级入口；不只是维护老连接。保留多个APIMart连接、地址编辑、Key更换、默认连接控制、现有模型管理、自定义平台、本地模型、导入导出、外部助手接入和网络诊断。新手折叠高级项，但用户遇到网络错误可直接抵达地址/诊断。删除连接继续沿原有确认与影响提示，不能默默删历史任务所需身份。详见 function-census.md。

## F13 暂缓能力：文本缓存、云通知
不进入I1–I6的必交范围，也不展示“已开启”按钮。
- 缓存：稳定设定前缀+实时问题分离，具体TTL/计费/usage因模型协议不同。须先有真实重复调用成本与延迟量具，再放到现有AI策略；首次写入/存储可能额外收费，不能自动预热。
- webhook：终态通知需要公网后端，回调可能重复；签名契约未完整统一，部分Grok说明HMAC仍不等于全平台。只有取得完整契约才验签采信，否则只能提示重新查询官方原任务。不作为桌面版前置，不把任务回调当支付回调。
来源：[缓存](https://docs.apimart.ai/en/api-reference/texts/gemini/context-cache)、[任务回调](https://docs.apimart.ai/en/api-reference/tasks/webhook)。

## F14 平台合作：尚无公开合同的能力
第三方授权与回跳、程序化Key生命周期、订单创建/结算回调、邀请归属查询、账户专属报价、通用音视频字节直传未在本轮找到完整公开契约。不能写虚构endpoint或用网页私有API直接交付。现阶段采用官方网页与一次Key粘贴，保留原稿；收到正式契约后先补字段、权限、异常、回调验签与真实验证，再修改S03/S06。邀请码既有注册入口沿仓库配置，不在此设计包复制或新建。


## 精确调用示例（设计合同，不是当前实现）
```json
{"model":"gpt-image-2-official","prompt":"用户可见的局部修改描述","image_urls":["<source-url>"],"mask_url":"<same-size-alpha-mask-url>","size":"16:9","resolution":"1k","quality":"medium","output_format":"png","n":1}
```
```json
{"model":"seedance-2.5","omni_reference_task_type":"edit","video_urls":["<source-video-url>"],"prompt":"用户可见的编辑描述","size":"adaptive","duration":-1,"resolution":"720p"}
```
```json
{"model":"flowmusic","clip_id":"<source-clip-id>","start_s":10,"end_s":20,"instruction":"用户可见的音乐修改描述"}
```
图像/视频查询沿各模型已准入mapping；Flow Music 使用 /v1/music/tasks/{task_id}。示例中的素材URL由现有运输边界产生，不允许直接把本地路径当公网URL。
