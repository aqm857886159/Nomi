# 源任务再生成的输入修复

状态：实施中。

## 事实与范围
- 现场镜头 3 的请求缺 source_task_id；连线源视频实际上为 2560×1440，24 fps，带音轨，已是 2K。
- 源任务类模型声明只有文本 task ID，通用请求构造未从生成结果取来源，发送前也未要求非空。
- 在模型档案声明源任务约束；通用构造器读取真实结果来源；共享发送边界拦缺字段。
- 保留用户模型、密钥、提示词、旧输出；不将已有 2K 再付费生成，不改为插值放大。

## 先查别人
- 规范：https://platform.minimax.io/docs/api-reference/video-generation-v2-regeneration
- 官方支持 source_task_id 或 base_video 二选一；任务 ID 方式限本账号成功 H3 768P，7 天内且需白名单。
- Nomi 现有接入只实现任务 ID 方式；本次完善该既有路径，不混入普通参考视频或伪造 base_video。
- 标准字段 source_task_id 原样保留；内部来源约束只属于模型档案，不改变外部协议。
- 现有档案 `electron/shared/videoCapabilities/minimaxH3Regeneration.ts:4` 已声明手填任务 ID，沿用它的协议字段，不新建供应商特例。
- 现有付费边界 `electron/runtime.ts:335` 已统一调用 profile preflight；缺失规则应在此入口的共享实现执行。
- 相邻修复 `docs/fixes/2026-09-24-video-reference-default.root-cause.json:1` 解决媒体槽偏好；源任务身份不能冒充参考视频槽，详见本次结构评审。

## 实施与验收
- 用当前失败形状先验证红测试；覆盖连线、原节点切模型、显式 ID、缺来源、多来源、跨供应商及已为 2K。
- 从原结果 provenance 读取 provider/model/resolution，禁止从已切换的节点 meta 推测原生成参数。
- 不自动选用其他历史结果；明确选择的源与手写 ID 冲突时拦截。
- 运行相关测试、类型与合同检查及构建；在 Windows 实际入口验证已为 2K 的提示和有效源任务投影。
- 恢复现场节点到可直接使用的原始 2K 成片；保持失败历史可追溯。

## 回滚
- 修改在独立 worktree；部署前备份当前启动器、构建与用户工程，校验后切换；失败则恢复原入口。
- 未完成远端合并或真实付费 768P 再生成时分别如实报告，不将本地测试称为正式发布。
