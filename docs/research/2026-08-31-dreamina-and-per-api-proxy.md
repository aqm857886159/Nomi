# 即梦 CLI 能力与按 API 代理研究

日期：2026-08-31

## 结论

本机官方 `dreamina` CLI（`54f1bdf-dirty`, build time `2026-06-18`）的 `-h` 是当前最直接的 CLI 契约。它已经声明：

- `image2video`：即梦 3.0 / 3.0fast / 3.0pro / 3.5pro，以及 Seedance 2.0 家族；3.0 时长 3–10 秒，3.5pro 时长 4–12 秒。
- `frames2video`：即梦 3.0 / 3.5pro，以及 Seedance 2.0 家族；比例由输入图推断。
- `multiframe2video`：2–20 张图；2 张使用 `--prompt`/`--duration`，3 张以上使用 N-1 个 `--transition-prompt`，并支持重复的 `--transition-duration`，单段 0.5–8 秒、总时长至少 2 秒。
- `text2video` 与 `multimodal2video` 仍只列 Seedance 2.0 家族；不能把 3.x 变体塞入这两个模式。
- 图片 CLI 当前列的是 `5.0`，不是 `5.0 Pro`。因此本仓库继续把即梦图片 5.0 与 KIE/方舟等供应商的 Seedream 5 Pro 分开；没有官方 CLI 证据就不伪造 `5.0pro`。

火山方舟官方 Seedance 2.5 文档是另一条 HTTP API，模型 ID 为 `doubao-seedance-2-5-260628`，端点为 `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`；文档声明最长 30 秒、最多 30 张图/10 个视频/10 个音频。它不属于即梦 CLI，不能用即梦本地进程去承载。

## 本次实现边界

1. 为即梦 3.x 图生与首尾帧增加独立能力档案和 catalog mapping，只暴露各自真实支持的模式。
2. 将多帧 CLI 的单段时长对齐到官方 0.5–8 秒，并对 3+ 图重复生成 `--transition-duration`。
3. 将即梦图片 3.0/3.1 与 4.x/5.0 的分辨率选项按 CLI 契约收窄，避免把 4K 发给不支持的模型。
4. 为手动 API 连接增加可选的单连接代理。代理只跟随该 Vendor 的发现、认证、生产和 SDK 请求；空值继续走既有应用网络路由。本地 CLI（即梦、ComfyUI）不继承该 HTTP 代理配置。

## 设计依据

- 即梦官方入口：[jimeng.jianying.com/cli](https://jimeng.jianying.com/cli)
- 火山方舟官方 Seedance 2.5 教程：[volcengine.com/docs/82379/2607688](https://www.volcengine.com/docs/82379/2607688?lang=zh)
- Undici 官方 `ProxyAgent`：[github.com/nodejs/undici](https://github.com/nodejs/undici)

## 验证边界

本机可以验证官方 CLI help、参数构造、模式/变体矩阵和代理路由单元测试；真实会员生成仍取决于用户本机登录态和积分，不能把 CLI 契约测试写成“已完成真实生成”。
