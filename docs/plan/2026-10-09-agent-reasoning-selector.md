# 创作助手推理等级选择

改动名：模型弹层推理等级；负责人：Codex 实现线；类别：新界面、模型参数。

| 格 | 决定与证据 |
|---|---|
| 1 用户怎么用 | 打开模型弹层→选对话模型→在其下选推理档→发消息→重开仍保留。真实任务：本地 CLIProxy Sol 从 high 切 low、切回 high；目录没有推理声明的 Grok 不新增不可用控件。复用用户截图的布局、NomiSelect 和组件尺寸。 |
| 2 谁说了算 | 用户选择由 assistantModelPref 单一保存，目录声明可用档；主进程验证，pi 的 setThinkingLevel / streamSimple 生成实际 reasoning 请求。 |
| 3 一致与复用 | buildV4ModelRows / V4ModelRow / NomiSelect 原有组件；getSupportedThinkingLevels 和 setThinkingLevel 原有 SDK 能力。禁止保留会覆盖选择的固定 CLIProxy 后缀。 |
| 4 全状态 | 支持模型显示档位；缺声明不画；运行中档位不可切；切模型按该模型默认档；保存失败不假称生效。中文与英文走 i18n。 |
| 5 中途表 | 空闲选择不花费；连点最后选择保存；运行中禁止更改本轮；关窗/重启读取已存偏好；断网不影响本地偏好，发送错误沿既有错误门。 |
| 6 外部数据与失败 | 目录显式 reasoning/thinkingLevelMap；不推测 Sol 的未声明等级。主进程严格校验字段，SDK 校验能力。CLIProxy 真实请求核对 suffix 已移除、reasoning.effort 随选择变化。 |
| 7 性能预算 | 一个模型、最多七个 house SDK 档；无轮询、无新增网络请求，档位切换只写小型偏好。 |
| 8 真实条件 | Windows 主机、用户实际 CLIProxy 账号、Sol/非推理目录、zh/en 弹层与键盘；满1M输入/128K输出负载不属于该选择器验收。未验证项目明确标记。 |
| 9 验收与回滚 | 实现线跑 wire/persistence/row 测试和构建；reasoning_verify 独立只读审查。生产部署前备份 dist 与目录目标条目，回滚仅本功能产物和该模型推理元数据。 |

独立验收报告在完成后补入；尚未验收不得宣称界面或有效路由 PASS。
