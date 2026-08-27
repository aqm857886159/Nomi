# pi R0 兼容验证记录

## 结论与范围

**R0 本地验收通过，可以进入 R1。不是产品接入或三空间统一 Agent 已完成。**

基线 `84abca8d012cc78cf8692f929351db65a314a985`，任务分支 `codex/unified-agent-pi-20260826`。实现位于 `experiments/pi-agent-runtime/`，pi 三个包固定 `0.84.3`。产品源码和根依赖尚未引用实验包；根 lint 只排除实验生成的 dist/release，仍检查实验源码。

使用真实 SDK、真实本机 HTTP/SSE、真实 Electron 主进程；仅模型响应是可控夹具。没有读取用户密钥、操作真实项目或调用付费模型，模型额度消耗为 0。

## 本轮最终命令与结果

命令均从仓库根执行；最后一项代码修复后重新测试和打包，不复用旧 ASAR 冒充当前构建。

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 兼容测试 | `pnpm --dir experiments/pi-agent-runtime test` | exit 0；48/48，无跳过 |
| 实验源码及测试类型 | `pnpm --dir experiments/pi-agent-runtime run typecheck` | exit 0 |
| 主仓完整门禁 | `pnpm run gates` | exit 0；747 测试文件通过、1 跳过；6546 测试通过、1 跳过 |
| 隔离 ASAR 构建 | `pnpm exec electron-builder --projectDir experiments/pi-agent-runtime --config electron-builder.cjs --mac dir --arm64 --publish never` | exit 0 |
| 开发 Electron | `node experiments/pi-agent-runtime/scripts/run-electron-probe.mjs --dev` | exit 0 |
| 打包 Electron | `node experiments/pi-agent-runtime/scripts/run-electron-probe.mjs --packaged` | exit 0 |
| 同构建核验 | 对 CJS 入口、8 个 adapter JS、HTTP fixture 的磁盘/ASAR 内容逐个比较 SHA-256 | 10/10 相同 |
| 规格 / 质量审查 | 独立审查、作者修正、原审查者复验 | 均通过，无未处理发现 |

主仓 gates 的 97 个既有 lint warning 在 98 棘轮内，0 error；构建保留既有 Browserslist/chunk-size 提示。实验测试独立运行，不能把根 Vitest 数量当作已包含这些 48 项。

## 验证到的行为

- 三协议：OpenAI-compatible Chat Completions、OpenAI Responses、Anthropic Messages。实际捕获精确模型、路径、字面密钥/headers、无鉴权请求、输出上限和 profile hook。
- 资源隔离：没有默认 shell/read/edit/write、自动读取目录指令/Skill/凭证或刷新网络模型目录。普通 prompt 只注入 Nomi 内容，压缩仍保留 SDK 自己的摘要 prompt。
- 工具：同一份 Zod 原始参数校验和 preprocess/transform；无效输入不进入宿主；两工具串行；批准结果不重复执行；拒绝可回喂模型。
- 附件：真实图片字节；Anthropic document 和 Responses input_file 的原生 PDF；多附件、相同文件名、快照恢复后继续使用。compatible 的原生 PDF 明确拒绝，不伪装文本抽取。
- 快照：完整工具对、usage、分支叶子、压缩边界、自定义附件 metadata 保留；损坏内容与跨分支错误边界被拒绝；历史工具不重放。
- 生命周期：运行中 Stop、工具等待、prompt 启动预检、手动压缩、分支摘要、dispose；Stop 返回后旧请求不能迟到启动；dispose 后不能新发请求。

开发与打包探针都实际完成「工具调用 → 回复 → 完整快照 → 新 Session 恢复 → 续聊」：**4 次 HTTP 请求、1 次宿主工具执行**，恢复文本正确，两个 Session 均 dispose，临时目录清理成功。

## 审查中实际抓到并修复的缺陷

| 缺陷 | RED 证据 | 最终回归 |
| --- | --- | --- |
| 快照只校验 entry 外壳 | 删除 message 后导入成功但读取崩溃；content:null 被默默投影为空 | 校验必需 payload，保留合法扩展 metadata |
| 压缩边界误指旁支 | firstKeptEntryId 指向 abandoned sibling 会丢当前上下文 | 必须在该 compaction 的 parent 祖先链 |
| 启动后立即 Stop | Stop 返回时 HTTP=0，旧 prompt 随后仍请求并追加历史 | 公开 preflight gate + 启动代次；3 个新增竞态先红后绿 |
| 同步宿主错误漏取消监听器 | 同一轮 12 次同步错误，每次多留 1 个 listener | 同步 catch 清理；原审查探针最终 listener=0 |

其他 TDD 还抓到协议默认 output cap、Anthropic 重复 `/v1`、原始 Zod 参数被 SDK coercion 改写、摘要输出预算丢失、摘要停止未等待等接缝差异；均有对应真实 wire 或生命周期断言。

## 包装和依赖成本

- 已验平台：macOS arm64；Electron `43.4.1`、内嵌 Node `24.18.1`。命令行测试 Node `22.22.0`。
- ASAR：**86,304,181 bytes**。SDK 带来的 TUI/图像等依赖仍在，不能把「不用编码 UI」说成零额外依赖。
- 打包进程审计 1,648 次模块解析，外部依赖 0、bootstrap 例外 0；6 个直接依赖均在自身 ASAR。开发态仅允许 Electron 已加载的 default_app bootstrap 文件。
- 本产物是未签名、无发布、独立 appId 的验证应用。其总包体不是 Nomi 产品的增量成本；产品内依赖重叠及 afterPack 影响仍须 R1 实测。

## 明确未覆盖

1. 六条 Nomi 真入口、IPC 窗口归属、模型 profile/错误分类全接线，以及旧工作缓存迁移：R1 工作。
2. 项目级共同会话与创作/生成/预览共同宿主：R2-U1 工作；新增 UI 仍先审真实布局样张。
3. Windows/Linux 包装、正式签名、真实供应商质量与计费、真实用户体验：本报告不作完成声明。
4. 工作快照不是项目文档、审批收据或生产账本；停止聊天不能撤销已受理媒体任务。宿主必须在副作用前检查取消和目标归属。
5. 兼容实验默认关闭自动压缩并测试手动压缩。完整历史保留 PDF，压缩后上下文不承诺重新发送所有历史附件。

实现和重跑说明见 [实验 README](../../experiments/pi-agent-runtime/README.md)；下一阶段见 [R1 实施卡](../plan/2026-08-26-pi-r1-runtime-cutover.md)。
