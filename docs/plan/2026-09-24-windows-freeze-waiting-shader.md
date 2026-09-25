# Windows 导入/生成卡死 + 假报「新建项目失败」修复方案

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

日期：2026-09-24
来源：v0.22.0 用户反馈（Windows）——「新建项目、刚导入图片就卡死，CPU 猛转」「第一次卡死是用 a6api 的图片模型生图」「强退前电脑卡了一会，恢复后项目库顶上出现『新建项目失败，请检查本地磁盘权限』」。

## 结论

两条互相独立的根因，本机 Windows 11（RTX 4060 Laptop，ANGLE/Direct3D11，Electron 43）确定性复现后修复：

1. **卡死**：等待/导入动效用的第三方库 `img-fx@0.5.1` 把 26 种特效塞进同一个片元着色器、运行时按 `u_effect` 分派，主函数为模糊还把这个分派调用了 5 次。ANGLE 把 GLSL 译成 HLSL 交给 D3D 编译器，后者全部内联展开：**首帧编译 100,168 ms，期间渲染线程同步等待（界面全死），随后 GPU 进程崩溃（exit_code=2）**，连续几次后 Chromium 封掉该页 WebGL，画布报「React Flow 画布加载失败」。导入（导入渐显）与生成（等待动效）共用这个着色器，所以两条路都卡。macOS 走 Metal 不受影响，因此此前所有性能测量（均在 macOS）都没发现。上游已有同一问题报告且未修：<https://github.com/Jakubantalik/img-fx/issues/3>。
2. **假报错**：「新建项目」入口把「打开被后来的打开顶掉（`ProjectHydrationSupersededError`）」当成失败报出；其它打开入口都把它当正常。界面卡住期间用户多点的几下会排队、恢复后一起执行 → 建出多个空项目 + 前一次被顶掉 → 「新建项目失败，请检查本地磁盘权限」。

## 先查别人（R5）

- 上游 issue <https://github.com/Jakubantalik/img-fx/issues/3> 给出三种修法：只保留用到的特效分支 / 按特效分别编译 / 异步编译（`KHR_parallel_shader_compile` / `compileAsync`）。本方案取第二种：它不改变任何视觉、对所有预设通用，不需要平台分支。
- three.js 官方 <https://threejs.org/docs/#api/en/materials/ShaderMaterial.defines>：`defines` 直接生成 `#define`；改 defines 后置 `material.needsUpdate = true` 由渲染器换用对应程序，官方示例同一写法见 `node_modules/three/examples/jsm/csm/CSM.js:465`（`_updateUniforms`，`:484` 置 `needsUpdate`）。
- 仓库约束：`docs/engineering/framework-boundaries.json:1300`（`custom-generation-shader`）登记「等待效果由 img-fx 提供，不能另造 shader 或 GPU renderer」→ 不自写着色器，用 pnpm 标准 `patchedDependencies`（<https://pnpm.io/cli/patch>）给 img-fx 打补丁。

## 改动

| 文件 | 改动 |
|---|---|
| `patches/img-fx@0.5.1.patch` + `package.json` `pnpm.patchedDependencies` + `pnpm-lock.yaml` | 着色器的 `if (u_effect == N)` 链改成 `#if/#elif IMG_FX_EFFECT == N … #endif`；共享材质加 `defines: { IMG_FX_EFFECT: -1 }`；按预设写 uniform 时同步 define 并 `needsUpdate`。es/cjs 两份构建同改。 |
| `src/workbench/project/projectCreationFlight.ts`（新） | `shareInFlight`：同一时刻只跑一次（离开项目与新建项目共用，删掉 `useProjectLeaveAction` 里手写的那一份）；`openCreatedProject`：被顶掉 → `opened:false`，不抛。 |
| `src/workbench/NomiStudioApp.tsx` | `createAndOpenProject`（新建项目与示例旅途两个入口的唯一编排点）经上面两个函数走。 |
| `src/workbench/project/useProjectWindowLifecycle.ts` | 改用 `shareInFlight`，行为不变。 |

不动：img-fx 的视觉参数、预设、揭示逻辑；等待层准入（`GenerationWaitingSurface`）；项目创建 IPC 与主进程落盘。

## 证据

- 着色器单独编译（同一台机器，`scratchpad` 探针，Electron 43）：原版 100,168 ms + GPU 进程崩溃；26 种特效 ×1 次调用 13,965 ms；**补丁后 Nomi 生产预设（effect 25）185 ms**；effect 22 / 11（仅设计实验室用）1.3 s / 1.9 s。
- 视觉等价：SwiftShader 下原版与补丁版逐像素哈希一致（effect 0 / 7 / 11 / 18 / 22 / 25 六种全部相同）。
- 真应用（中文项目目录、8 张真实生成图）：修复前第一张图拖入后渲染线程阻塞 92–100 s、画布崩溃；修复后拖入 / 工具栏导入 / 粘贴 / 生成等待 / 结果揭示 / 回库 / 重开 / 切项目，渲染线程最大帧间隔 ≤ 273 ms，GPU 进程零崩溃。
- 连点「新建空白项目」：修复前 2 个项目 + 横幅「新建项目失败」；修复后 1 个项目、无横幅。
- 测试：`waitingEffectShaderProgram.test.ts`（换回原版 img-fx 5/5 红）、`projectCreationFlight.test.ts`（改回旧行为 4/7 红）。

## 回滚

`git revert` 本 PR 即可：补丁由 pnpm 在安装时施加，删掉 `patchedDependencies` 条目与 patch 文件后 `pnpm install` 回到原版 img-fx；创建编排只是一处调用点。

## 验收门

- `pnpm run gates` 按风险分档通过；Windows 真应用巡检（`scratchpad/windows-freeze-sweep.mjs`）无 > 500 ms 的渲染线程阻塞、无 GPU 进程退出。
- 未验证（记 `unverified`）：macOS 上补丁后的首帧编译耗时（机制上只减不增）；Intel 核显 / AMD 显卡的 D3D11 编译耗时（D3D 编译器在 CPU 上跑，与显卡厂商无关，但未实测）。

## 第三条：同步盘 / 杀毒占用文件时存盘锁永久卡死（同一轮巡检发现，用户拍板一起修）

**现象**：项目文件夹放在同步盘里（我们「换电脑继续」的引导正是这么建议的）或被杀毒扫描时，一次保存后，之后每次保存、导入、粘贴、生成结果落盘、导出、Agent 写入都先干等 5 秒再失败，界面常驻「项目保存失败」，回不了项目库、关不了窗口，只能强退并丢掉之后的全部修改。

**机制（带插桩实测，3 次运行各复现一次）**：释放锁要把 `.nomi/manifest-transaction.lock` 改名挪走；同步盘 / 杀毒恰好在 `owner.json` 刚写出时以只读共享打开它，Windows 上这让目录改名直接 EPERM（POSIX 允许，所以 macOS 永远碰不到）。旧代码随即抛 Lost、锁目录留在原地，记着的是**本进程自己的 pid** → `process.kill(pid,0)` 说还活着 → 此后本进程每次取锁都被自己挡住，直到退出（每次运行 5181–8612 次拒绝）。同类相邻路径：读不到别人的 owner.json 被当成「记录坏了」而可能强拆活锁；发布失败后的清理错误盖掉可重试错误；release / quarantine 残留目录挡住同步调用方；注册表锁残留让下一次调用在主线程干等 3 秒。

**先查别人**：graceful-fs 对 win32 rename 的 EPERM/EBUSY/EACCES 做退避重试（<https://github.com/isaacs/node-graceful-fs/blob/main/polyfills.js>）；Windows 共享模式语义见 <https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew>；仓库已有同一策略的 `renameSyncWithRetry`（`electron/jsonFile.ts:33`），只是锁目录操作一处都没用。

| 文件 | 改动 |
|---|---|
| `electron/jsonFile.ts` | 抽出 `retryOnSharingViolation` / `isSharingViolation`（唯一一份重试策略），`renameSyncWithRetry` 改为调用它 |
| `electron/workspace/workspaceManifestLock.ts` | 本进程在持锁表（按 nonce，模块级集合）；「记录是本进程、但没有在持的操作」＝残留，立即收回（锁与隔离区都适用）；读 owner.json 遇共享冲突 → 忙，绝不强拆；释放遇共享冲突先重试，仍失败就交出所有权、后台补收（0.25/1/4/15/60 s），不再把已提交的事务报成失败；清理失败不再盖掉原错误、不再挡住下一次取锁；超龄候选目录按年龄回收 |
| `electron/workspace/workspaceRegistry.ts` | 注册表锁释放时的 rmdir 走同一重试 |

**证据**：真应用「模拟同步盘占用」巡检（新文件一出现就只读共享打开 300 ms）修复后：无锁错误、无「项目保存失败」、回项目库正常、GPU 零崩溃、占用结束后无残留锁目录（只剩一个关窗前一刻的候选目录，不挡任何人，下次取锁按年龄回收）。单测 7 条（其中一条起真实 PowerShell 进程占文件）修复前全红。根因合同 [`docs/fixes/2026-09-24-manifest-lock-sharing-violation.root-cause.json`](../fixes/2026-09-24-manifest-lock-sharing-violation.root-cause.json)。

## 仍未覆盖 / 已知小问题

- 导入完成后，进度用的临时预览 `.import-previews/*.preview.jpg` 被挪成正式预览，正在卸载的进度层仍去读旧地址 → 控制台 404；用户无感知。
- 冷启动后第一次「新建项目」渲染线程阻塞约 1.1–1.3 s（第二次 0.23 s）。
- 占用期间事件日志追加会被丢弃（设计上尽力而为）；主进程单次操作最多约 0.8 s 花在同步重试上。
- 没在真实 OneDrive / 坚果云 / NAS 目录、360 / 火绒下测；没测视频导入、导出、3D 导演台、Agent 对话、用户自己的 a6api 真实生图。
