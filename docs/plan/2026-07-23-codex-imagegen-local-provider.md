# Codex 本地生图桥接计划

## 背景

目标是在 Nomi 的模型接入体系里增加一个实验性“Codex 生图”模型，通过本机 `codex exec` 调用当前用户的 Codex 登录态和 `$imagegen` 能力。入口保持极简：不单独增加“Codex 本地生图”配置卡，只要“接入 AI 编程助手”里的 Codex 已接入，就认为这个生图模型可用。

实测结论：

- `codex exec --json` 可用。
- 默认 `image_generation` feature 为 `false`，必须传 `--enable image_generation`。
- `service_tier = "default"` 会让当前 CLI 启动失败，实测 `-c service_tier='fast'` 可跑。
- 启用后生成文件落在 `~/.codex/generated_images/<thread_id>/*.png`。
- `codex exec -i <image>` 支持单图改图；`-i` 可重复传多张图，支持多图参考生成。实测两种方式都会返回 `thread.started` 并落图。
- Windows 下直接 `spawn("codex.cmd", ...)` 会报 `spawn EINVAL`，必须通过 `cmd.exe /d /s /c` 包装，并启用 `windowsVerbatimArguments`。
- prompt 不作为命令行长参数传递；使用 `codex exec ... -`，把 prompt 写入 stdin，避免中文、换行、特殊字符在 Windows shell 中变脆。

## 范围

- 新增一个默认关闭的内置供应商 `codex-local`。
- 新增一个图片模型 `codex-imagegen`，展示为 `Codex 生图（登录额度）`，接 `text_to_image` 和 `image_edit`。
- 通过现有 `HttpOperation.process` 分支扩展 `parser: "codex-cli-image"`。
- 由主进程 spawn `codex`，解析 JSONL 的 `thread.started`，扫描 `~/.codex/generated_images/<thread_id>`，把图片写入 Nomi 项目资产。
- 新增 `codex-imagegen` 图像档案：像即梦图片一样提供“文生图 / 改图”两个模式；改图模式使用 `image_ref` 输入槽，最多 10 张，输入键为 `reference_images`。
- 改图/多图参考请求把 `reference_images` 物化为本地文件，并对每张图追加 `-i <path>`。
- `codex-local.enabled` 跟随 AI 编程助手里的 Codex MCP 接入状态：
  - 一键接入 Codex 时启用。
  - 撤销 Codex 接入时关闭。
  - 打开模型设置时，如果发现 Codex 已接入但 `codex-local` 仍关闭，则自动同步打开。
- `codex-local` 不进入“其他模型/自定义中转”卡片，避免同一能力出现两个入口。

## 不做

- 不读取或解析 `C:\Users\Administrator\.codex\auth.json`。
- 不调用 Codex 内部私有接口。
- 不额外设计一套 Codex 改图 UI；改图复用 `codex-imagegen` 档案的 `image_edit` 模式和现有参考图输入槽。
- 不把失败静默 fallback 到 OpenAI Platform API 或其他图片模型。
- 不新增独立 Codex 生图配置卡。
- 不修改现有 KIE/APIMart/RunningHub/ComfyUI 等供应商行为。

## 实施步骤

1. 扩展 `electron/catalog/types.ts` 的 process parser 枚举。
2. 新增 `electron/catalog/codexCli.ts`，封装 `codex exec`、Windows `.cmd/.bat` 包装、stdin prompt、参考图 `-i` 参数、JSONL 解析、生成图扫描。
3. 修改 `electron/catalog/processOperation.ts`，按 parser 分发到 Codex 或 Dreamina。
4. 新增 `electron/catalog/codexImages.ts`，声明 vendor/model/mapping。
5. 修改 `electron/catalog/seedBuiltins.ts`，默认关闭 seed。
6. 新增 `src/config/modelArchetypes/codexImagegen.ts` 并注册到档案表，让生成页显示“文生图 / 改图”模式。
7. 修改 `src/ui/onboarding/ConnectAssistantCard.tsx` 和 `OnboardingDrawer.tsx`，把 `codex-local` 可用性派生到“接入 AI 编程助手”里的 Codex 接入状态。
8. 增加 focused tests，覆盖：
   - Windows `.cmd` spawn 包装。
   - 带参考图时提示词要求基于附件图片生成。
   - Codex JSONL 解析 thread id。
   - 按 thread id 找到最新生成图。
   - seed catalog 里有默认关闭的 `codex-local` 供应商，以及 `text_to_image` / `image_edit` 两条 mapping。

## 异步找回补充

用户侧目标：Codex 生图/改图也复用 API 模型已有的等待时间、超时提示、以及“重新拉取结果”。

当前同步实现的问题：`codex exec` 完整结束后才返回 `succeeded`；超时会杀掉子进程并抛错，前端拿不到 `queued/running + taskId`，因此不会进入 `waitForCatalogTaskResult` / `recoverNodeResult` 的现有可找回链路。

调整方案：

1. Codex `create` 改成本地异步 job：启动后台 `codex exec` 后立即返回 `{ submit_id: jobId, gen_status: "queued" }`。
2. Codex mapping 增加 `query` op，`fetchTaskResult` 用同一个 jobId 查询本地 job 状态。
3. job 运行期间返回 `generating`；发现 `thread.started` 后记录 threadId，并扫描 `~/.codex/generated_images/<thread_id>`。
4. 出图后导入 Nomi asset 并返回 `success`；进程退出且无图时返回 `fail` 和人话错误。
5. job 记录落盘到 `CODEX_HOME/nomi_image_jobs/<jobId>.json`，App 重启后如果已经拿到 threadId，仍可通过“重新拉取结果”扫描 generated_images 找回结果；没有 threadId 且进程已随 App 退出，则诚实失败，不重新提交。
6. 不改前端轮询 UI，不新增独立 Codex 卡，不读取 `auth.json`。

## 验收

- `pnpm run test -- codexCli codexSeed processOperation`
- `pnpm run typecheck`
- `pnpm exec eslint electron/catalog/codexCli.ts electron/catalog/processOperation.ts electron/catalog/codexImages.ts electron/catalog/codexCli.test.ts electron/catalog/codexSeed.test.ts`
- `pnpm run build:electron`
- `git diff --check`
- Windows smoke：`codex --version` 返回本机 Codex CLI 版本；Nomi 内部通过 `buildCodexSpawnInvocation("codex.cmd", ...)` 覆盖 `.cmd` 包装。
- Codex exec stdin smoke：`codex exec ... -` 返回 `thread.started`。
- 单图改图 smoke：`codex exec ... -i <image> -` 返回 `thread.started` 且落图。
- 多图参考 smoke：`codex exec ... -i <image1> -i <image2> -` 返回 `thread.started` 且落图。
- 真实 async smoke 通过：`startCodexImageOperation` 返回 `queued`，随后 `queryCodexImageOperation` 多次返回 `generating`，第 9 次返回 `success` 并导入 `nomi-local://smoke/codex-image-019f8d5f.png`。

手工命令可复验：

```powershell
codex -c service_tier='fast' --enable image_generation --ask-for-approval never exec --json --ephemeral --sandbox workspace-write --skip-git-repo-check -C <workdir> -o <last-message.txt> -
```

## 审查优化

- job 落盘记录只保存找回必需字段，不保存用户 prompt 或 Codex stdout/stderr；运行期诊断仍保留在内存 job 中。
- `seedVendor` 改为结构类型 `VendorSeed`，避免每新增一个内置供应商都扩展超长 union。
- Codex MCP 接入/撤销时，同步 `codex-local.enabled` 改为 best-effort；即使目录写入暂时失败，也不误报 MCP 配置失败，打开模型设置时会再次按 Codex 接入状态派生修正。
