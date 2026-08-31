# 模型接入全集用户旅途测试

日期：2026-08-15
基线：`origin/main@452df94d`
分支：`codex/model-access-exhaustive-journeys-20260815`

## 目标

用生产 Electron 构建和真实可见界面回答一个问题：用户拿着自己现有的接入材料，能否完成“进入接入页 -> 配置 -> 验证 -> 在真实节点执行 -> 看见可消费结果”，失败后能否从原处修复，并且不会破坏已有模型。

“全集”不等于列出全世界供应商名称。它指当前生产代码中可枚举的入口、鉴权、协议、任务类型、素材输入、模型模式、输出形状和恢复动作全部被独立盘点，并由覆盖这些差异的最小旅途组合逐一穿透。新增生产能力但没有旅途时，门岗必须变红。

## 用户材料全集

| 用户手里有什么 | 必测入口 | 诚实终点 |
|---|---|---|
| 已知平台的单个 Key | 已知供应商卡 / 官方预设 | 真实节点产物或可操作失败 |
| App ID、Token 等复合凭证 | 多凭证配置 | 真实音频/文本产物或明确缺口 |
| 中转地址和 Key | 模型列表发现 / 自动适配 | 每个模式独立验证，不连坐已有模式 |
| URL、Key、模型 ID | 最小材料探测 | 只报告观察到的事实，不猜测“已可用” |
| curl、请求和响应样例 | 自定义调用 | 可见请求/响应诊断后在原节点重试 |
| 文档 | 声明式配置或自定义调用 | 文档字段逐项映射并试跑 |
| ComfyUI 地址或工作流 | 本地工作流入口 | 对应实例生成真实媒体 |
| 已登录 CLI / 本地进程 | 登录态或本地进程入口 | 检测运行时；缺插件时明确不支持 |
| 什么都拿不到 | 保存草稿 / 下一步动作 | 不得伪装验证通过 |

## 能力维度

- 入口：已知单 Key、复合凭证、中转发现、官方协议预设、自动适配、自定义调用、ComfyUI、登录态 CLI、本地进程、失败回诊、模型类型纠错、最小材料。
- 鉴权：无鉴权、Bearer、`x-api-key`、query、复合凭证、自定义 header、OAuth/session。
- 协议和生命周期：同步 JSON、SSE、create/poll、create/status/result、multipart、binary、NDJSON、process、HTTP+WebSocket。
- 任务：chat、prompt refine、文生图、图生提示词、图生视频、文生视频、改图、文生音频、图生音频、转录、文生 3D、图生 3D。
- 素材：inline base64、公开 URL、上传流、上传后 URL、multipart、ComfyUI 上传、匿名链路、本地进程文件。
- 模式：输入字段名、单值/数组、角色序号、供应商参数、模型 enum、role 对象数组、有序扁平数组、固定参数、变体。
- 输出：文本、URL、base64、二进制、本地文件、异步资产；最终证据必须是像素、可解码音频、视频帧、可见文本或 3D 像素，不以 HTTP 200 代替。
- 恢复：鉴权、URL、模型类型、请求形状、限流、服务端错误、超时、坏响应、空输出。

## 每条旅途的六阶段证据

1. `entry`：用户从真实设置或原节点错误入口进入，不直接调内部 API。
2. `persisted`：界面保存后读取独立的磁盘快照，证明只完成持久化。
3. `observed`：fixture 或真实平台记录实际请求，分别证明鉴权、端点和 payload。
4. `executed`：从生产节点点击生成，不能用后台 IPC 调用代替。
5. `rendered`：对最终媒体做内容检查；截图只证明 UI 状态，不能证明媒体有效。
6. `recovered`：故障旅途在同一节点修正并重试，保存前后的已有模型快照必须一致。

连接保存、连通检查、模型模式验证和生产启用是四个状态。测试不得把任意前一状态写成后一状态。

## 测试结构

### 独立盘点

测试侧用 TypeScript AST 读取生产 union、供应商预设、模型档案和接入抽屉实际挂载组件。旅途 manifest 只声明测试组合，不能反过来定义生产全集。任何新生产枚举、入口组件或档案 wire 形状没有被旅途拥有时失败。

### 确定性协议 fixture

本机 HTTP fixture 记录真实网络请求并模拟同步、流式、异步、上传、二进制、NDJSON 和错误注入。它用于证明通用 wire，不声明某个真实平台已经可用。

### 生产 Electron 旅途

所有 roundtrip 脚本复用 `tests/ux/_launchApp.mjs` 启动 `dist-electron`，使用隔离用户目录，通过 Playwright 可见控件操作。每步写结构化 span、截图、脱敏请求和产物证明。

### 真实平台 canary

在凭证存在时复用应用已有凭证跑至少两个不同 HTTP 平台、三个 model/mode 组合，以及 ComfyUI/登录态/本地进程可用项。没有凭证、文档或运行时时状态只能是 `BLOCKED` 或 `NOT_RUN`，不能退化成 fixture PASS。报告固定文档 URL、检查日期、模型、模式和实际 request id。

## 第一批旅途

| ID | 用户目标 | 关键交叉 |
|---|---|---|
| J01 | 中转发现后生成图片和视频 | Bearer、sync、poll、已有模型保护 |
| J02 | 已知平台单 Key 生成图片 | `x-api-key`、multipart、base64 |
| J03 | 复合凭证生成可播放音频 | multi-credential、NDJSON、binary |
| J04 | 三种文本协议返回可见文本 | Chat Completions、Responses、Anthropic、SSE |
| J05 | 自动适配某模式失败后单独修好 | per-mode revision、同节点重试 |
| J06 | 只有 curl 时接三段队列 API | custom header、upload、create/status/result |
| J07 | 自定义调用现场修字段 | 实际请求、上游错误、原节点重试 |
| J08 | ComfyUI 预设、导入、多实例 | HTTP+WebSocket、实例归属、真实媒体 |
| J09 | 登录态 CLI 的多参考模式 | 首尾帧、参考图/视频/音频、本地文件 |
| J10 | 本地进程生图 | 运行时检测、真实像素 |
| J11 | 自动分类错误后改类型并生成 | 类型修复、mapping 同步更新 |
| J12 | URL/Key/限流/超时/坏响应回诊 | 动作正确、同节点成功 |
| J13 | 模型声明的全部参考槽和 wire 形状 | 有序多模态、模式/变体 |
| J14 | 配音、转录和 3D 产物 | 可解码音频、可见文本、3D 像素 |
| J15 | 无文档最小材料的诚实推进 | 探测证据、不得猜成功 |
| J16 | 再次添加同 host 的新模型 | 旧凭证、脚本、映射、启用状态不变 |

## 报告和退出码

- `PASS`：六阶段中该旅途要求的全部证据成立。
- `FAIL`：产品行为与合约不符，或测试检测到回归。
- `BLOCKED`：缺用户独有凭证、外部运行时或官方服务不可达。
- `NOT_RUN`：操作者明确只运行了子集。
- `HARNESS_ERROR`：测试基础设施自身故障。

必跑 fixture 旅途中出现 `FAIL/BLOCKED/NOT_RUN/HARNESS_ERROR` 均返回非零。真实 canary 的 `BLOCKED` 不伪装失败，但发布报告不得把它计入通过率。

## 不改项

- 本 PR 不修生产接入能力，不为测试新增生产后门。
- 不把 fal、Replicate 或任何平台名写进通用 runtime 分支。
- 不读取或写入用户真实项目；所有 Electron fixture 使用隔离目录。
- 不输出 API Key、Cookie、Authorization 或完整用户路径。

## 回滚

删除新增的测试目录、脚本入口和本计划即可。测试产物只写 `.tmp/model-access-journeys/`，由 `.gitignore` 排除。

## 验收门

1. 独立盘点器能在添加未覆盖生产能力时稳定失败。
2. 每个声明为 roundtrip 的旅途都有可执行脚本，脚本实际启动生产 Electron。
3. 报告包含每阶段耗时、截图、脱敏 transcript 和最终媒体证明。
4. J16 对磁盘快照做深比较，防止同 host 新增模型重验、重启或覆盖旧模型。
5. 至少跑完全部本地 fixture 旅途；外部缺条件项逐条报告 `BLOCKED` 原因。
6. `check:filesize`、`check:tokens`、`check:i18n`、`lint:ci`、`typecheck`、`test`、`build` 全部通过后才提交。
