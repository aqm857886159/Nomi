# 打包后「每条命令都要点头」= 沙箱运行时的二进制卡在 app.asar 里

> 📎 教训 · 首次记录 2026-09-12 · 状态：现行
> **触发场景**：用户说「Agent 每跑一条命令都要我确认」「开了全自动还是一直问」；或者你给一个**随 `dependencies` 进包**的库加了新用法，而这个库带 `vendor/`、`bin/`、`.node`、`.jar`、`.exe` 之类**要被当文件交给别的进程**的东西。

**结论（两半，缺一半都不work）**：

1. **`build.asarUnpack` 让盘上有一份真的。** 凡是不能只被 `import`、还要被 exec / `dlopen` / `-javaagent:` 的依赖资产，都要列进去；pnpm 布局写两条（`node_modules/<pkg>/**` 和 `node_modules/.pnpm/<pkg 转义名>@*/**`）。
2. **但 `asarUnpack` 不改任何人手里已经拿着的那个字符串。** 库自己用 `import.meta.url` 算出来的路径仍然指进 `app.asar`。所以还必须由我们**显式把解包后的路径交给它**（0.0.75 开的口子是 `seccomp.applyPath` / `javaAgentJarPath` / `windows.srtWin.path`）。

第 2 条是这次真正踩的坑。只做第 1 条会得到一个看起来修好了的包——文件在 `app.asar.unpacked/` 下躺得好好的，一次也不会被用上。

## 机制：`existsSync` 会说谎

`app.asar` 是**一个归档文件，不是目录**。Electron 给自己进程的 `fs` 打了补丁，于是：

- 主进程 `readFileSync('.../app.asar/node_modules/x/vendor/y')` —— **读得到**（解包了就悄悄改道去读 `app.asar.unpacked` 那份）；
- `existsSync(同一条路径)` —— **回 `true`**；
- 同一条路径交给 `execve`、交给 JVM、交给任何别的进程 —— **`ENOTDIR`**。归档不是目录，内核不会帮你解压。

这就是最坏的失败形状：**探测说有，使用说没有**。上游库的找法全是「挨个候选 `existsSync`，第一个 `true` 就用」——

```js
// dist/sandbox/generate-seccomp-filter.js（java-proxy-agent.js / windows-sandbox-utils.js 同构）
const baseDir = dirname(fileURLToPath(import.meta.url));   // 打包后 = app.asar/.../dist/sandbox
return [join(baseDir, rel), join(baseDir,'..','..',rel), join(baseDir,'..',rel)];
```

打包后第一个候选就 `existsSync === true`，于是它**停在归档里那条路径上**，后面的候选一个都不试，然后把这条路径 spawn 出去。解包与否完全不影响这个结果——`import.meta.url` 是**模块的加载路径**，而模块是从 `app.asar` 加载的。

### 实测（2026-09-12，Electron 43.4.1 / macOS arm64）

用打包产物自己的 Electron 以 `ELECTRON_RUN_AS_NODE=1` 跑探针：

| 问的问题 | 归档里（未解包） | 解包后（`asarUnpack` 已加） |
|---|---|---|
| `getApplySeccompBinaryPath()` 返回什么 | `…/app.asar/…/vendor/seccomp/arm64/apply-seccomp` | **还是 `…/app.asar/…`** |
| Electron 的 `existsSync` | `true` | `true` |
| `/bin/cat`（= 别的进程看到的） | `Not a directory` | **`Not a directory`** |

阳性对照（证明这不是探针的毛病）：已解包的 ffmpeg，走 `app.asar/...` 那条路径 `execFileSync` 得到 `spawnSync … ENOTDIR`，走 `app.asar.unpacked/...` 正常打印版本号。**Electron 不会为 spawn 改写路径**——它只改写自己 `fs` 的读。

## 影响面：别把 macOS 也算进去

同一批实测里还有一条反直觉的结果，值得单独记住，免得下次按错误的前提排错：

**macOS 上沙箱从来没坏过。** 把整个包塞进一个纯 asar 里（连解包副本都没有）再 `SandboxManager.initialize()`，仍然 `active:true`，`wrapWithSandbox` 正常返回。原因是 seatbelt 这条路只要 `/usr/bin/sandbox-exec`（系统自带，`man sandbox-exec` 写着 deprecated 但在 macOS 25.5 上在位可用），策略正文走 argv/临时文件，**一次都不碰 `vendor/`**。

所以真正会被这条 bug 打到的是：

- **Windows**（`nsis` 是在发的目标）—— `srt-win.exe` 是 spawn 出去的 broker；
- **Linux** —— `apply-seccomp` 由 bwrap exec（Nomi 当前不出 Linux 包，但配置是共用的）；
- **三个平台的 java agent** —— 沙箱里跑 JVM 时 `-javaagent:<jar>` 由 JVM 打开。

下结论前先量：「打包后沙箱就是不行」这句话按平台是假的，按平台又是真的。

## 它为什么能潜伏

`openLaneSandbox` 的设计是**失败不抛**——起不来就返回 `active:false`，命令照跑、只是每条都要人点头（`electron/agentLane/laneCodingSandbox.mts` 头部写明了理由：不该让「这台机器没沙箱」长成「Agent 坏了」）。降级本身是对的（D4：缺口明着标），但当时**降级没有在界面上留痕**，于是这条回归不崩溃、不报错、CI 全绿，用户端唯一的症状是「Nomi 今天怎么这么啰嗦」——那和「我大概选错档位了」在界面上一模一样。开发树上更是永远复现不了：那里 `node_modules` 就是普通目录。

这次连带补上了 composer 上沿那行「命令需逐条确认：…」。**同一族的下一个候选：任何「失败就降级、不抛异常」的能力——降级必须在界面上留痕，否则它就是一条无声回归。**

## 怎么用

- 加任何随 `dependencies` 进包的库时，先数一遍外部资产：
  `find node_modules/<pkg> -type f \( -perm +111 -o -name '*.exe' -o -name '*.jar' -o -name '*.node' -o -name '*.dylib' \)`。有输出 = 两条 `asarUnpack` + 一条「谁来把解包路径交出去」。
- **先去翻上游有没有开显式路径的口子**（配置字段、env 变量）。有就用——那是 R29 意义上的「用框架给的接口」。没有，才谈别的办法；自己去 patch 上游的路径解析是最后一档。
- **别拿单测当证据**：`pnpm run test` 跑在开发树上，asar 根本不存在。打包后的证据走
  `node tests/ux/packaged-sandbox-active.e2e.mjs <打包产物>`——它同时问三件事：`active:true`、归档里每个 vendor 资产在解包处都有真文件、**以及生产代码交出去的每条路径都落在 `app.asar.unpacked` 下且 `statSync` 认它是文件**。前两条各证一半，第三条才是接缝。
- 配置本身的回归由 `scripts/packaging/sandbox-runtime-unpack.test.mjs` 守：通配符被收窄 → 覆盖断言红；上游升级把二进制挪出 `vendor/` → 清单断言红。
- 路径改写只有一处定义：`electron/shared/asarUnpackedPath.ts`。以前 ffmpeg 和 mediaProbe 各抄了一份，这次并成了一份——第三个调用点出现时，正是该并的时候。

**出处**：PR `fix/sandbox-runtime-packaging-20260912`；`package.json` 的 `build.asarUnpack`；`electron/agentLane/laneCodingSandbox.mts` 的 `laneSandboxVendorPaths`；`docs/release-process.md` §4 验收清单。

**相关**：[MCP 侧改动必须重新打包 app 才看得到](mcp-fixes-need-repackaged-app.md)
