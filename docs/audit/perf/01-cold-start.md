# 冷启动性能审计 · 01 · 点开到能动手

> 审计范围：双击图标 → Electron 主进程启动 → 首屏渲染 → 项目库/Onboarding 可交互。
> 只读审计，未改任何源码。产物体积取自当前 `dist/`（2026-06-22 13:15 构建）。

## 一句话结论

冷启动最大的三个瓶颈，**全在「窗口出现之前」的主进程串行链路上**（`electron/main.ts:444-460`），而不是 renderer：

1. **窗口创建被两个网络/IO 操作串行 `await` 挡在前面** —— `applySystemProxy()`（含一次 `session.resolveProxy("https://api.openai.com")` 的系统 PAC/网络探测）+ `startCapabilityCore()`（起 RPC server + 写 instance.json）都在 `createWindow()` 之前 `await`，把首个像素往后推。**P0**。
2. **启动时同步读 + 解析 + 可能回写 105KB 的 catalog JSON**（`ensureBuiltinModelSeeds`，`main.ts:452`），主线程同步阻塞。**P1**。
3. **首屏白屏：窗口无 `show:false` + `ready-to-show` 兜底**，`backgroundColor` 在，但内容 ready 时机完全靠 renderer，dev 下还有 20×500ms 重试循环。**P1**（prod 影响小）。

renderer 侧整体健康（路由分包、stores 纯内存、start page 不挂 canvas/3D），唯一隐患是 **three.js 被静态打进 GenerationCanvas chunk**（开任意项目就拉 ~177KB gzip 的 three + ~150KB r3f），但这在「打开项目」路径，不在「点开到首屏」路径。

---

## 发现表

| # | 发现 | file:line | 运行时机制（为什么慢） | 用户可见症状 | 严重度 | 修复方向 | 怎么实测验证 |
|---|---|---|---|---|---|---|---|
| 1 | `applySystemProxy` 在 `createWindow` 前被 `await`，内含 `session.resolveProxy("https://api.openai.com")` 系统代理/PAC 探测 | `main.ts:449`（链路 `:444-460`）+ `systemProxy.ts:135` | `whenReady` 回调是**串行 await 链**：proxy 探测→种子→registerIpc→capabilityCore→createWindow。`resolveProxy` 走系统网络栈解析代理配置，有 PAC 脚本/慢 DNS 时可阻塞数十~数百 ms，**全程挡在窗口创建前**。注释自己说「须在任何出站请求前完成」——但其实只需在首个**出站 fetch** 前完成，不需在**窗口**前完成。 | 点图标后图标弹跳/Dock 起来了，但窗口迟迟不出现（黑屏等待期） | **P0**（置信度高：代码确为 await 串行；实际耗时取决于用户代理环境，有 Clash/PAC 的中国用户最明显） | 把 `applySystemProxy` 改成**不阻塞窗口**：`createWindow()` 先跑，proxy 探测并行（`void applySystemProxy(...)`）或仅保证在首个 vendor 出站请求前 settle（用一个 ready Promise gate 出站层，而非 gate 窗口）。 | 在 `whenReady` 首行与 `createWindow` 前后打 `performance.now()`；对比「直连环境」vs「设了 HTTPS_PROXY 指向慢端口」两种启动到窗口可见的毫秒数 |
| 2 | `startCapabilityCore`（起 127.0.0.1 RPC server + ensureToken + 写 instance.json）也在 `createWindow` 前 `await` | `main.ts:459`；`appIntegration.ts:31-50` | 同样串行挡在窗口前。起 HTTP server + 文件写盘虽快（通常 <10ms），但叠加在 #1 后面继续累加首屏延迟。它声明 fail-open（不影响 app），但**时间上仍前置于窗口**。 | 与 #1 叠加的窗口出现延迟 | P2（置信度高：确为 await；单独耗时小） | 移到 `createWindow()` **之后**或并行 `void startCapabilityCore(...)`。能力核就绪不是首屏前置条件（外部 MCP 探测可稍后就绪）。 | 同 #1，测 `startCapabilityCore` 单步 `performance.now()` 差值 |
| 3 | 启动时同步 `readFileSync`+`JSON.parse` 105KB catalog，且 `applyBuiltinSeeds` 后可能再同步 `writeJsonFileAtomic` 回盘 | `main.ts:452` → `catalogStore.ts:58-63`（`readJson` = `runtimePaths.ts:58` 同步 readFileSync）；磁盘实测 `model-catalog.json` = **105 KB** | `ensureBuiltinModelSeeds` 同步读+解析整个 105KB catalog，比对种子，若有变化同步原子写回。全在 `whenReady` 主线程，串在窗口前。首个 `nomi:projects:list`/`model-catalog:*` IPC 还会**再次** `readCatalog` 同步解析一遍（无缓存）。 | 启动期主线程卡顿；catalog 越大越明显（用户接的模型越多文件越大） | **P1**（置信度高：同步 IO + 解析确凿；105KB 解析约个位数 ms，但叠加在串行链 + 每次 list 重复解析放大） | ① `ensureBuiltinModelSeeds` 移到窗口后/惰性；② `readCatalog` 加进程内缓存（写时失效），避免每个 list IPC 重复 readFileSync+parse 105KB | 在 `ensureBuiltinModelSeeds` 前后打点；统计冷启动内 `readCatalog` 被调用次数（加临时 log）；造一个 500KB catalog 看启动退化 |
| 4 | 渲染层项目读写走**同步 IPC `ipcRenderer.sendSync`**（`projects.list/read/save/create/delete` + 整个 `modelCatalog.*`） | `preload.ts:5-11`、`:24-28`、`:178-194` | `sendSync` **阻塞 renderer 主线程**直到主进程回复（主进程那头是同步磁盘读）。`projects.list` 经 SWR 在挂载后 revalidate（非首帧），但触发时是一次同步磁盘遍历 IPC，会 jank。`projects.read` 在**打开项目**时同步阻塞，挡在 studio 首个可交互帧前。 | 项目库列表刷新瞬间卡一下；点开项目时 UI 短冻 | P1（置信度高：sendSync 确凿；单次磁盘读通常快，项目多/磁盘慢时放大） | 把 `list`/`read` 改 `ipcRenderer.invoke`（异步）。`list` 已在 SWR 后，改异步最容易，零体感损失。 | renderer console 里 `performance.now()` 包住 `projects.list()`/`read()` 调用，量阻塞毫秒；多造 100 个项目看 list 退化 |
| 5 | three.js + R3F + drei 被**静态**打进 GenerationCanvas chunk（非 lazy 隔离） | `GenerationCanvas.tsx:38` → `StagingCaptureHost` → `Scene3DAutoCapture.tsx:5-7`（`import * as THREE` / `@react-three/fiber` / `@react-three/drei`） | `StagingCaptureHost` 为「离屏截图必须全局常驻」而被画布静态引入（见记忆 staging-reference），连带把 three 拉进画布 chunk。`three-vendor` = 688KB（177KB gzip），`r3f-vendor` = 464KB（150KB gzip）。**开任意项目（哪怕纯 2D 无 3D 节点）都要下载+解析这 ~327KB gzip**。 | 第一次打开项目时画布出现前有解析停顿（尤其低端机） | P1（置信度高：import 链确凿、体积实测；但在「打开项目」路径，不在「点开→首屏」路径） | 把 `Scene3DAutoCapture` 的 three 依赖移到 lazy 边界后；`StagingCaptureHost` 常驻但其 three 渲染体在真正需要离屏截图时才动态 import three。 | `pnpm build` 后看 `GenerationCanvas` chunk 是否还引 three-vendor；Chrome perf 录开项目时 three chunk 的 evaluate 耗时 |
| 6 | 首屏 CSS 单文件 `index-*.css` = **295 KB**（45KB gzip），render-blocking | `dist/assets/index-D1Hx3kXC.css`（源头 `src/main.tsx:12` `./styles/index.css`） | 单个大 CSS 由 `<link>` 阻塞首次渲染。45KB gzip 不算大，但全量样式（含 workbench/canvas 样式）在 start page 也一次性加载。 | 极轻微首屏延迟 | P2（置信度中：体积已知，render-block 机制确凿，但 gzip 后量不大） | 评估是否值得拆（多数 SPA 不拆，优先级低）；确认未把 workbench-only 样式塞进首屏 critical CSS | Lighthouse / Chrome coverage 看首屏未用 CSS 占比 |
| 7 | 字体经 `@fontsource-variable` 在 `main.tsx` 顶层 import（Inter + Fraunces 变量字体）| `main.tsx:10-11` | 变量字体 woff2 经 CSS `@font-face` 加载；`index.html` 的 boot spinner 已用系统字栈兜底，故不阻塞 spinner。字体未就绪前正文可能 FOUT/短暂回退。 | 首屏文字可能闪一下字体（FOUT） | P2（置信度中：自托管本地字体，无外网请求，影响小） | 维持现状即可（已自托管、有 fallback 字栈）；如在意 FOUT 可加 `font-display: optional` | 慢速 CPU 录屏看首屏是否有字体跳变 |
| — | （非问题，记录）窗口已设 `backgroundColor: "#f6f3ee"` 且 `index.html` 内联 boot spinner | `main.ts:166`；`index.html:18-55` | 白屏期至少有底色 + 转圈，不是纯黑/纯白 | 启动有视觉反馈 | — | — | — |

---

## 关键体积数据（实测 `dist/`）

| chunk | 原始 | gzip 估算 | 进入时机 |
|---|---|---|---|
| `three-vendor` | 688 KB | ~177 KB | 打开项目（经画布静态引入，#5） |
| `NomiStudioApp` | 474 KB | — | studio 路由（lazy，首屏不拉） |
| `r3f-vendor` | 464 KB | ~150 KB | 打开项目（#5） |
| `tiptap-vendor` | 308 KB | — | 创作区（lazy，正确隔离） |
| `index`（入口） | 217 KB | — | 首屏 |
| `index` CSS | 295 KB | ~45 KB | 首屏 render-block（#6） |

首屏入口 chunk（`index` 217KB）本身不含 three/tiptap，分包是对的。重库都在 lazy chunk，**唯一漏网是 three 进了画布 chunk（#5）**。

---

## 主进程串行启动链（`main.ts:444-460`，这是 P0 的核心）

```
app.whenReady()
  → registerLocalProtocol()              // 快
  → installContentSecurityPolicy()       // 快
  → await applySystemProxy(session)      // ⚠️ #1 含 resolveProxy 网络探测，挡窗口
  → ensureBuiltinModelSeeds()            // ⚠️ #3 同步读+解析+可能写 105KB
  → registerIpc()                        // 快
  → await startCapabilityCore(...)       // ⚠️ #2 起 RPC + 写盘，挡窗口
  → await createWindow()                 // 窗口终于创建 + loadURL
```

**治本方向**：窗口创建是首屏体感的命门，应尽量前置。`createWindow()` 不依赖 proxy/capabilityCore/seeds 任何一个的完成——把这三个改成「窗口之后并行」或「仅 gate 各自的下游消费点（出站 fetch / 外部 RPC / 首次 catalog 读）」，而不是 gate 窗口。预期能把「点开到窗口可见」显著前移，尤其代理环境用户。

---

## 建议真机实测的项（后续串行跑）

1. **冷启动到窗口可见**：在 `whenReady` 首行、`createWindow` 前、`loadURL` resolve 后各打 `performance.now()`，量三段毫秒。重点对比**直连** vs **设 `HTTPS_PROXY` 指向一个慢/不可达端口**两种环境（验证 #1 的代理探测阻塞）。
2. **冷启动到首个可交互帧**：renderer 里在 `main.tsx` 顶部记 `performance.now()`，在项目库首个按钮可点时（一个 `useEffect` + `requestAnimationFrame`）再记一次，得「点开→能动手」总毫秒。
3. **catalog 解析开销**：临时在 `readCatalog` 加调用计数 + 计时 log，跑一次冷启动，确认它在启动期被调用几次、解析 105KB 各耗时（验证 #3 的「无缓存重复解析」）。再造一个 ~500KB catalog 看退化曲线。
4. **打开项目的 three 解析**：Chrome DevTools Performance 录「项目库点进一个 2D 项目」，看 `three-vendor`/`r3f-vendor` chunk 的 Evaluate Script 耗时（验证 #5 对非 3D 项目的无谓成本）。
5. **`projects.list` sendSync 阻塞**：造 100+ 项目，renderer console 量 `window.nomiDesktop.projects.list()` 单次阻塞毫秒（验证 #4）。
6. **首屏 CSS 覆盖率**：Chrome Coverage 面板看 start page 加载的 295KB CSS 实际用到多少（验证 #6 是否值得拆）。
