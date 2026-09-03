# MCP #202 余账与群反馈修洞班

## 范围

只修后端、状态、持久化、校验和诊断：API 健康错误生命周期、模型列表错误、生成 ETA、模型切换 changeset、导出 Artifact 登记，以及全屏视频/本地协议观测。先核对当前 main 已有的参考槽和 ComfyUI 输出模态修复；已有覆盖则只补回归证据，不造第二套实现。

明确不改 UI 控件、布局或面板；错误诊断文案若变更，报告标注为现有错误反馈的可读性修复。API 删除按钮、匿名上传通道选型、kling omni 多图 XML 问题均不在本次实现范围。

## 根因与实现边界

| 洞 | 根因假设 | 最早共享边界 | 验收 |
|---|---|---|---|
| API 校验横幅 | renderer 保留了按旧配置指纹缓存的错误快照，配置目录变更没有使快照失效 | `useVendorHealth` 的模型目录变更事件订阅 | 配置变更、供应商删除、模块重启均不再复用旧错误 |
| 参考槽 / ComfyUI | 当前 main 已把媒体槽和 Comfy 输出节点集中到共享声明/推断边界 | `archetypeMeta`、`comfyuiWorkflowOutput` | 视频参考和 H3/SaveVideo 回归测试；若已绿则不改生产实现 |
| 模型列表错误 | 上游无 message 时错误格式化器丢弃了 HTTP/body/下一步 | `modelListProbe` 的统一上游错误诊断 | HTTP、body 摘要、下一步建议均存在且脱敏 |
| ETA | 确认卡在 renderer 内硬编码媒体秒数，没有消费 durable vendor call 终态 | 历史事件聚合 + ETA 纯函数 | vendor×model×kind 的 P50/P90；冷启动只给区间 |
| 模型切换 | patch builder 只返回最终 meta，丢失清理/默认变更事实 | `buildNodeModelChangePatch` | changeset 三列和最终 patch 同时可查 |
| 导出 Artifact / 播放观测 | 导出/本地响应事实没有完整接入项目 Artifact 与事件链 | production export artifact 写入、local protocol/video instrumentation | job/version/path 可查询；响应码与 video 状态进入事件 |

## 不动项与回滚

不改变供应商协议、UI 结构、现有 `.nomi/events` 写入格式的兼容字段；旧事件、旧导出 job 和旧 Artifact 继续可读。每个逻辑洞单独提交，必要时按 commit 回滚。最终在最新 `origin/main` 上按受影响风险面跑 contracts、unit、Electron/持久化相关门和全量 gates。

## 真实验收

先用现有 focused tests 建立当前 main 基线；每个生产修复先让对应回归测试在修复前红，再修到绿。参考槽和 ComfyUI 若基线已覆盖，保留测试证据并在报告标记“当前底座已修，无新增生产改动”。不启动 UI 样张流程。
