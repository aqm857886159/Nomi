# Skill 聚合区与全屏 Agent 验收矩阵草案

本矩阵沿用 #472 的 M0-M5 语义和项目真实用户测试合同。H/B/E/T/N 依次是 Happy、Boundary、Error、Timeout、Network；另加真实 Electron、持久化/重启、视觉和 provider evidence，不以其中一项替代另一项。

| featureId | H | B | E | T | N | 必须补的真实证据 |
|---|---|---|---|---|---|---|
| `skill.catalog` | 发现→详情→选择→prompt token | 空/长描述/重复/hash 缺失 | 目录不存在/manifest 无效/provider 不满足 | reload/project switch/restart | 本地目录不发外网；远程 401/403/404/5xx 分类 | 真实 Skill store/Host projection、来源 hash、收藏重启读回 |
| `agent.fullscreen` | 进入全屏仍可对话并回工作面 | 1100×720、窄/宽、折叠、长文本 | Host gate off、无模型、错误 surface | 切工作面/项目/关闭重开 | 纯导航不发 provider 请求 | Electron DOM geometry、ARIA、同一 Thread/receipt |
| `storyboard.canonical` | 选行→提议→批准→分镜/画布更新 | all/空选/Unicode/重复 operation/未点名字段 | stale revision/wrong project/旧 alias | approval 中关窗/恢复/undo | MCP 断连/offline | canonical tool、effect、receipt、persistence、restart |
| `video.deconstruct` | URL/本地视频→转换→关键帧/表格→编辑导出 | 0 秒/长视频/多语言/无音轨/部分镜 | URL 无效/转换失败/ASR/VLM 失败 | provider polling/转换超时 | TikHub 401/403/429、断网 | `ffprobe`、帧连续性、字幕/对白时间、真实表格保存/导出 |
| `media.result` | 图片显示/视频播放→发送调整 | 无结果/大文件/codec/多结果 | 播放失败/结果失效 | 下载/轮询/取消 | provider 5xx/非 JSON/费用未知 | provider request id、usage/cost、artifact、项目绑定、重启 |
| `privacy.settings` | 默认不收集，用户显式 opt-in | 切换语言/删除/导出 | 配置损坏/删除失败 | 设置重载/升级迁移 | 上传端点不可达 | 不含 prompt/媒体/key/原始项目的审计证明 |

## 真实用户任务

1. 进入全屏 Agent，选 Skill、切模型、上传/引用资料、发送并看到可编辑结果。
2. 在 Agent 内改脚本/分镜，预览后批准或拒绝，关闭重启读回 revision、receipt 和未点名字段。
3. 播放图片/视频结果，发送调整，确认结果与对话属于同一个 project/thread。
4. 输入视频 URL，经历转换、关键帧、字幕/对白表格，编辑行列并导出。
5. 触发网络/权限/超时/下架/恶意正文路径，确认无未授权写盘、生成、扣费或外发。

## 当前状态

当前仍是 `planned / partially-observed / blocked-live`，不是“已合入且已证明”。现有历史测试如果基于旧 SHA、fixture、loopback 或 skipped package/canvas 检查，必须在 `89dcd913` 上重跑后才能升级。
