# 设计卡：APIMart 接入与持续创作
日期：2026-11-03；负责人：Codex；本 PR 类型：文档 + 可交互 HTML exploration，不修改生产接口、状态、支付或模型行为。

## 设计主张
新用户先看到作品价值，再完成一次 Key 接入，返回原作品继续创作。三个宿主：项目库、现有设置、原画布；评审导航和接口说明不进入产品。暖灰、紧凑排版、真实随包素材，复用 Nomi tokens。主要取舍：推荐要清楚，已有连接及高级控制仍可达。

## 前置事实与三条路
- 历史选择：[地址归用户改](../../../plan/2026-09-29-apimart-address-editable.md)、[自检不等于试跑](../../../plan/2026-10-26-onboarding-honest-probe.md)、[设计流程](../../../engineering/design-pipeline.md)继续有效。
- 沿现有设置与任务链扩展（选用）：一次 Key、账户事实、模型与价格、原任务恢复，最少新状态源。
- 另建账户／任务中心：用户多一个地方找状态，且重复数据 owner，不采用。
- 直接删除其他供应商：旧任务身份和音视频上传依赖尚未解决，不采用。
- 用户明确要求先看 HTML，后要求把整合方案提交 PR。这里交付可评审、可实施的设计包；不把 HTML exploration 视为已获正式设计板批准或生产实现。后续正式组件搭建仍走设计流程。

| 格 | 结论与证据 |
|---|---|
| ★0 先例 | [官方快速开始](https://docs.apimart.ai/en/quickstart)：网页建 Key → 确认只保留一次粘贴；[Cherry Studio 集成](https://docs.apimart.ai/en/integrations/chat/cherry-studio)：手配供应商地址 → 新人默认预填但高级可编辑；[OAuth PKCE 先例](https://openrouter.ai/docs/guides/overview/auth/oauth)：浏览器授权回跳 → 仅作为合作方向，不假定 APIMart 已有；[官方幂等结果不确定](https://docs.apimart.ai/en/api-reference/images/grok-imagine-2.0-ext/generation)：新 Key 重发有重复扣费风险 → 明确待核对状态。前三条先例已经在前一轮研究使用，本轮承接；不把别家能力当成本平台能力。 |
| ★1 用户任务 | 新手从随包角色参考做第一张分镜，再作为视频首帧；已有用户继续历史任务；资金不足用户充值后返回原稿。量具：preview walkthrough（verification.md），观察填写项／切换次数／草稿保留，生产首次出片耗时和完成率未验证：缺真实新用户样本。新手只需 Key，老手保留地址/协议/连接控制。 |
| ★1b 连带面 | 项目推荐、模型设置、生成 composer、结果来源详情、任务错误、Agent 指向回执都读取同一连接/任务身份；Agent 不放第二套参数编辑器。 |
| ★1c 老用户 | 不改连接 ID、密钥绑定、默认模型、旧 taskId 和任务 mapping；多连接保留。没有生产数据迁移，本 PR 不改变旧版本数据。未来更换连接必须先验证候选，失败不覆盖旧连接。 |
| ★2 owner | 凭据归现有 catalog / credential vault；账户事实在主进程读取并按 connectionId+credentialRevision 隔离；模型归 catalog/archetype；价格归现有 shotPricingRule 边界；运行归 Run/task；结果归 projectAssetStore。详见 contracts.md。预览用内存固定示例，不读真实用户配置。 |
| ★3 复用 | 使用现有 SettingsDialog、模型接入、composer、ProvenancePanel、任务取回与素材落地；本 PR 仅静态演示和设计资料，样张引用生产 token 文件与随包图片，不安装新依赖。 |
| ★4 全状态 | 未连接／检查中／部分检查成功／认证失败／网络失败／余额不足／Key 限额／价格未知／任务执行／提交不确定／下载失败／部分产物／链接过期／能力不可用均有原地下一步。取消仅为本地停止等待，不承诺上游取消退款；所有已设计主屏支持 zh/en、明暗。 |
| 5 打断 | 见 README 的中途表。关闭设置保留原稿；重启用原 taskId；连点不重复提交；支付返回只刷新；退款状态不从界面关闭推断。 |
| 6 外部数据 | 官方文档和匿名价格快照仅作契约依据；参数 schema 不完整、公开价不等于账户价。原始错误脱敏，未知金额不变成 0，用户输入不进 URL/日志。 |
| ★7 性能 | 本 PR 无生产运行路径。HTML 使用本地图片、按当前状态渲染，不拉完整目录。未来预算：点击反馈 p95≤150ms，缓存目录展开≤150ms，网络请求有独立可见状态；生产性能量具未建，不以原型替代 perf:scenarios。实施任务须登记场景后再交付。 |
| 8 真实条件 | 预览检查 zh/en、明暗、桌面/窄窗、键盘；检查结果见 verification.md。真实账户、支付、生成、Windows 和跨地区网络均 unverified。 |
| ★9 验收 | check.mjs 检查页面/功能/接口引用闭合；浏览器按主链、两类故障、编辑动作走查；确认所有支付/生成均演示、无真实 Key 输入、无自动付费。独立审查检验可实施性和功能保留。反例：支付回跳自动生成、余额未知显示0、所有模型统一幂等、关闭本地等待称平台已取消、无法回到原草稿，任一出现不通过。撤回此文档提交即可，生产无迁移。 |

## 交付与批准边界
本 PR 的“可落地”是合同、状态、owner、顺序和验收清楚；没有公开契约的 OAuth、订单、邀请查询、通用音视频上传写出依赖与不具备时的操作，不伪造可调用端点。本 PR 不新增正式 board.json，也不声明已实现。

## 改动范围
所有文件限于本目录。引用现有 resources/onboarding-demo 与 src/theme/nomi-tokens.css，不复制生产组件或修改运行时。未将私有研究原文、真实账号信息、邀请码、业务结算条款带入仓库。
