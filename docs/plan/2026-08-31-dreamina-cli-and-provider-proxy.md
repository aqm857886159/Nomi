# 即梦 CLI 能力补充与按 API 代理

## 目标

处理反馈中的“即梦视频 CLI 更新”和“代理要按 API 单独配置”两个问题，修在能力声明与供应商网络边界，不为单个模型增加 UI 补丁。

## 范围

- 增加官方 CLI 已声明的即梦 3.x 图生/首尾帧能力。
- 对齐多帧的 0.5–8 秒单段时长与 `--transition-duration`。
- 收窄即梦图片清晰度，消除非法模型+分辨率组合。
- 手动 HTTP 连接保存可选 `proxyUrl`，并贯穿模型发现、连接测试、适配器认证、生产请求、AI SDK 请求和产物下载。

## 不动项

- 不把火山方舟 Seedance 2.5 伪装成即梦 CLI 能力。
- 不改现有 Seedance 2.0、ComfyUI 或其他供应商的模式/参数契约。
- 不把 per-API 代理应用到本地 CLI、ComfyUI 或没有配置该字段的既有连接。
- 不提交本地微信反馈原始数据、digest、API key 或代理凭据。

## 验收门

- 官方 help 对账矩阵有对应测试，非法模式组合在 UI/请求构造前不可达。
- 多帧 2 图与 3+ 图参数构造测试通过，包含小数时长和总时长下限。
- 连接保存/加载保留代理，代理变更会形成新的连接身份；空值与既有 catalog 行为一致。
- 模型发现、HTTP provider 请求和 AI SDK 请求均能使用显式 per-connection dispatcher。
- `typecheck`、受影响 focused tests、lint/i18n/filesize/heavy-path/waits/root-cause contracts 通过。
- 能力 UI 通过真实 Electron 入口走查；真实即梦生成若缺少用户登录态标为 blocked，不伪报成功。

## 回滚

回滚本任务提交即可：新增档案/mapping 与代理字段均为增量；旧连接缺少 `network.proxyUrl` 时仍使用既有应用 dispatcher。
