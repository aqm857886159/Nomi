# 旧版本落的用户目录

这里放的是旧版本**用它自己的真实函数**落到磁盘上的设置目录（真 service、真 store、真 promote、真卡登记），不是手写的形状。升级测试 `electron/catalog/upgradeKeepsWorkingModels.test.ts` 把它们当作「用户升级前的样子」，逐个模型核对三件事：还在模型列表里；发布的模式不少于主线；每个模式仍然只发一次 POST，路径和请求体和主线一字不差。

**这里所有的 Key 都是假的**（占位值，经 base64 存放，不通任何服务），所有地址都指向本机回环 `127.0.0.1:39017`。测试每次把目录拷到临时位置，把这个地址换成随机端口的假服务，仓库里的文件从不被改动，也不出网。

## 每份目录

| 目录 | 谁落的 | 怎么落的 | 里面有什么 |
|---|---|---|---|
| `catalogs/v0.20.0-wizard` | 0.20.0（目录格式 9，读取时会升到当前格式并留一份备份） | 在 0.20.0 的导出里跑 `generators/zzRelGen.ts.txt`：连接向导那条路，接 2 个图片模型和 3 个视频模型 | 图片 2、视频 3。图生图走对话接口，视频的文生和图生同一条路由 |
| `catalogs/v0.24.0-wizard` | 0.24.0（目录格式 13） | 同上，在 0.24.0 的导出里跑 `zzRelGen` | 图片 2、视频 3。一个图片模型的图生图是 multipart 上传 |
| `catalogs/v0.24.0-native-wire` | 0.24.0 | 先 `zzRelGen` 接 6 个模型，再在它的输出上跑 `generators/zzRelNative.ts.txt`（开机体检 `upgradeRelayModelsToNativeWire` 把其中一个视频行切到原生报文） | 上一份的 5 个，加一个带档案和原生报文的视频行 |
| `catalogs/v0.24.0-declared-card` | 0.24.0 | 在 0.24.0 的导出里跑 `generators/zzRelDeclared.ts.txt`：用真实的 `registerDeclaredProvider` 登记一张 AI 交的声明卡 | 视频 1，`card.json` 是登记它的那张卡（升级后重交卡用） |
| `catalogs/v0.24.0-wizard-audio` | 0.24.0 | `zzRelGen`，模型表换成音频 2 + 文本 1（`V_MODELS` 环境变量） | 音频 2、文本 1；带认证日志文件（`integration-certification/`）和备份，都是旧版本真实落下来的，原样保留 |

每份目录的 `expected.json` 是**从主线录的**，不是手写的：里面写着它录自哪个主线提交（`recordedFrom`）、读完目录后盘上的目录版本和留下的备份文件（`diskVersionAfterRead`、`backupFiles`），以及每个模型的 `listed`、`published`，和每个已发布模式发出的那一个请求（`modes.<taskKind>.request`，地址换成 `{{origin}}`，multipart 的边界去掉）。`v0.24.0-wizard/expected.hand-written-half-contract.json` 是同一份目录加「手写了半份能力合同」（只写文生，路由还有图生）那一格。

`via` 是这个请求怎么发的：`task` 是直接交一个任务；`canvas` 是图只能经档案的槽进请求的路由，用画布节点造的请求。写了 `unverified` 的模式不比对（要写明原因，并在 PR 里单列）；现在没有这样的模式。

## 怎么跑

```
pnpm exec vitest run electron/catalog/upgradeKeepsWorkingModels.test.ts
```

## 怎么给一个新版本补一份目录

1. 把那个版本的源码导出到一个空目录：`git archive <tag> | tar -x -C <空目录>`，装好依赖（或链接现成的 `node_modules`）。
2. 把 `generators/` 里要用的脚本复制进去，去掉 `.txt`，放到脚本里 import 的位置：`zzRelGen` 放 `electron/providerAdapter/zzRelGen.test.ts`；`zzRelNative`、`zzRelDeclared` 放 `electron/catalog/` 下。（这里存成 `.ts.txt`，是为了不被本仓的测试和类型检查收进去。）
3. 用 vitest 跑那一个文件，输出目录由环境变量给：`zzRelGen` 用 `V_REL_ROOT`（可选 `V_MODELS`：JSON 数组，每项 `{modelKey, labelZh, kind}`），`zzRelNative` 用 `V_REL_ROOT`（读）和 `V_OUT`（写），`zzRelDeclared` 用 `V_OUT`。地址必须是 `http://127.0.0.1:39017`，Key 必须是假的。
4. 把输出目录整个放进 `catalogs/<版本>-<名字>/`。先跑 `pnpm run check:secrets`，被拦就停下，不要绕过。
5. 在**干净的主线检出**（不是改动分支）上录 `expected.json`：设 `NOMI_RECORD_OLD_USER_DATA=<本目录的绝对路径>` 和 `NOMI_RECORD_COMMIT=<主线提交的完整 40 位>`，把测试文件放进那个检出的 `electron/catalog/`，只跑 `-t "saved by an older release"` 那一组。录不出「每个已发布模式只发一次 POST」，说明夹具或脚本错了，先查，不要放过。录完把放进去的测试文件删掉。

主线以后有意改了目录版本或发出的请求，同样用这个办法重录，并在提交里写明为什么。
