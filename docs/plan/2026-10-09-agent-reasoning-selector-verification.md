# 推理选择器独立验收

实现线：Codex 主线；独立验收线：`reasoning_verify`（只读，未修改源码、配置或 GUI）。

范围：现有模型弹层新增推理等级行；选择保存在原有助手模型偏好中，经主进程验证后使用 SDK 原生 reasoning 参数。

## 已验证

- 原生 HTTP 线测试验证 high→low、会话身份保持、冷重开仍 low、单次请求 low 与普通模型回到 off；测试通过。
- 目录声明的可选档与 SDK 的 getSupportedThinkingLevels 逐项一致；无供应商名称猜测。
- 偏好读写、未知偏好拒绝、选择器行位置、运行中禁止修改、非法档拒绝与非推理模型隐藏测试通过。
- 独立审查发现普通模型残留 high 状态；实现线修复并补了回归。回调依赖也已加入 reasoning，避免选档后继续发送旧值。最终审查无剩余可行动源码问题。
- 已亲眼检查中文隔离 GUI 截图：推理等级在对话下，布局正常。真实 CLIProxy 出站请求记录为无固定后缀的模型名，reasoning.effort 从 low 切为 high；输出上限保留 128000，上下文 1000000。
- 英文隔离 GUI 显示 Low / Medium / High / Extra high / Maximum；普通模型隐藏推理等级。
- 本机接口分别接受 low / medium / high / xhigh / max；所有实际请求 HTTP 200，所报 reasoning.effort 与请求相同。
- 最新主线与当前安装版本的单功能兼容副本均构建成功。按改动范围 lint 0 警告，全仓 lint 回到既有上限内。

## 未通过与限制

- 全库单测：17467 通过、189 失败，49 个失败文件；不能声明整体门禁全绿，失败日志由主线保留。没有为此扩大修改到分镜、下载、媒体、网络等无关模块。
- 全量 Contracts 包含分镜 owner 和 Windows hook 等失败；新增 callback 警告已修复并重测 lint。
- 标准 empty core-smoke 3/4 通过，一项因 Windows 默认 viewport 933 实测 934 失败；本功能 GUI 使用可整除 DPI 的 936 高度完成真实验证，不把它当作默认 core-smoke PASS。
- 尚未测试完整 1M 输入或 128K 输出负载；该改动只保留既有用户配置。
- 此源码 PR 的正式发布/合入验证仍需 CI 和协调线的 merged-SHA 收据；本报告不声明已解决或已合入。

回滚：revert 本功能提交；本机兼容产物部署使用独立备份，可恢复旧 dist / dist-electron 及仅该模型的推理声明。
