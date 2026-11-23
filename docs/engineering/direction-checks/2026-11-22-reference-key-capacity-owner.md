# 方向检查：参考键容量聚合、帧槽派生与自定义调用二进制响应主人收口（2026-11-22）

触发（`scripts/fix-churn.mjs` 当日实跑）：
- `electron/shared/modelArchetypes/referenceKeys.ts`：文件自身 0 次 fix，仅命中概念「headless 请求只把参考投进声明过且媒体类别相符的 body 键」与「发给供应商的参考图只能是当前方式声明、界面在用的那些」。
- `electron/vendor/vendorHttp.ts`：文件自身 1 次 fix，命中目录 `electron/vendor/`（近 14 天 2 个 fix）。
- `electron/catalog/customCallRunner.ts`、`electron/catalog/customCallSandbox.ts`、`electron/catalog/taskParamsReferences.ts`：0 命中。

属于 P1 例外口径（要改的文件本身均未达文件级第 3 次 fix，改法为在既有唯一主人处换掉残缺手写快照与单键特例、同提交删除 `taskParams.modeInputRoutes.test.ts` 旧挂起红名单与 `customCallRunner` 双分支 JSON 出网，不加模型名 / 路径特例）。

**这一处的全图在哪**：`docs/engineering/concept-owners/generation.headless-reference-key-projection.json` 与 `docs/engineering/concept-owners/catalog.custom-call-http-response.json`；交接处表外。

### 0. 一句话根因

① 参考键容量主人在未指定 `modeId` 时对首个命中方式直接 `return`、且帧键意图还留着 10 个手抄键名快照，令同一请求体键跨首帧与首尾帧共用时被锁死在 1 张、非 `first_frame*`/`last_frame*` 命名的首尾帧槽无法被识别；② 自定义调用沙盒把所有上游 HTTP 响应硬按 UTF-8 / JSON 解码并经 JSON 字符串过桥，令二进制响应在进脚本前就被 `U+FFFD` 损坏。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 94e59b73b 保留所选参考槽 | 只给带 `modeId` 的调用传了所选方式，`referenceKeyCapacityDeclarationFor` 无 `modeId` 分支仍取首个方式 `max: 1` 且 `modeMatchesTaskKind` 漏继承档案 `transportTaskKind` | 容量主人未按匹配方式取并集上限 |
| Higgsfield DoP / RunningHub 首尾帧 `最多收 1 张` | `FRAME_REFERENCE_KEYS` 手抄 10 个键，未从 `everyBuiltInArchetype()` 派生独占首尾帧槽 `inputKey`（`end_image_url`、`firstImageUrl`、`lastImageUrl` 等） | 手抄键表与档案声明分家 |
| 无 `modeId` 直传 `image_with_roles` 被第三闸判缺图 | `hasImageEditReferences` 只硬编码 `extras.image`，漏掉共享声明表里的其余参考载体键 | 局部单键特例绕开共享分类器 |
| `customCall` 上游回二进制流导致 `saveFile(bytes)` 报错或字节损坏 | `customCallRunner` 调 `requestJson`/`requestMultipart` 强转 UTF-8，且 QuickJS 桥只传 `JSON.stringify` 字符串 | 传输解码按单一 JSON 假设写死、缺按 `Content-Type` 解码与 `ArrayBuffer` 桥接 |

### 2. 为什么这一类会一直出现

「模型声明了什么」住在档案里，「脚本契约承诺了什么」住在 `customCallContract.ts` 里，但消费边界保留了早期手抄子集（手抄 10 个帧键、首个方式即返回、单键 `extras.image`、一律当 UTF-8 JSON 读体）。铁律 ⑪（能选到 / 声明覆盖全部入口）直接相关：档案已声明首尾帧双图与槽键，外部 / 无界面入口却因手抄子集拿到错误的 `max: 1`。

### 3. 不改结构的话，接下来会冒出什么（2–3 个可验证预测）

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| 任何新接的合并槽模型只要把单图方式排在首尾帧或参考方式前面，不带 `modeId` 发送 2 张参考图都会被拒 `最多收 1 张图片参考` | `npx vitest run electron/catalog/taskParams.modeInputRoutes.test.ts` |
| 任何新档案用非 `first_frame*` / `last_frame*` 命名首尾帧槽（如 `start_image_url` / `tail_image_url`），全目录扫描都会落进 `others` 红名单 | `npx vitest run electron/catalog/taskParams.modeInputRoutes.test.ts`（`expect(others).toEqual([])`） |
| 任何走 `FormData` 上传并直接返回 PNG / MP4 二进制流的自定义脚本（如 Stability v2beta、Sora 下载端点），字节必被 `U+FFFD` 破坏或把 64MB QuickJS 堆撑爆 | `npx vitest run electron/catalog/customCallTextAndFile.test.ts electron/tasks/syncBytesResultLandsInProject.test.ts` |

### 4. 靶子独立性检查

- APIMart 官方字段矩阵（`electron/parity/officialWire.matrix.test.ts` + `tests/fixtures/vendor-official/apimart/*.json`）独立采集自官方文档原句；`syncBytesResultLandsInProject.test.ts` 此前用 `{ bytes: [...bytes] }` JSON 包装绕过了真实二进制 HTTP 响应，本次保留原兼容用例并补齐真实 `audio/mpeg`、`video/mp4` 裸字节回环测试。

### 5. 这一整块归谁（P0）

这一整块：生成参考键的容量 / 帧意图声明投影，以及自定义调用沙盒的 HTTP 响应按媒体类型解码与二进制过桥
归谁：参考键容量与帧意图唯一归 `electron/shared/modelArchetypes/referenceKeys.ts:174`（从 `everyBuiltInArchetype()` 派生）；HTTP 媒体类型判别遵循 RFC 9110 `Content-Type` 标准并由 `electron/catalog/customCallRunner.ts:105` + `quickjs-emscripten@0.32.0` 原生 `newArrayBuffer` / `getArrayBuffer`（`electron/catalog/customCallSandbox.ts:227`）过桥
我们哪里绕开了它：`electron/shared/modelArchetypes/referenceKeys.ts:160,322` 用手抄 10 键与首方式早退替代了档案全量派生；`electron/catalog/taskParamsReferences.ts:93` 只硬编码 `extras.image`；`electron/catalog/customCallRunner.ts:241-247` 硬走 `requestJson` 把所有响应转成 UTF-8 字符串

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 给 Seedance 2.5 / Wan 3.0 写特例上限、给 `end_image_url` 手补一行、在沙盒用 base64 字符串兜底 | 小 | 会：下一个合并槽模型、下一个帧键名、大视频 base64 膨胀撞 64MB 沙盒上限都会再炸 | 中 | 否 |
| 换一种做法 | `referenceKeys.ts` 按 `modeTransportFor` 聚合匹配方式容量并从 `everyBuiltInArchetype()` 自动派生独占首尾帧槽键；`taskParamsReferences.ts` 改读 `classifyReferenceKey`；`customCallRunner` + `vendorHttp.requestBinary`（支持 `FormData`）按 RFC 9110 `Content-Type` 解码，二进制经 `quickjs-emscripten@0.32.0` 原生 `newArrayBuffer`/`getArrayBuffer` 零膨胀过桥（`electron/catalog/customCallSandbox.ts:227`） | 一次改清两处主人并补齐红灯先行回归 | 不会：新档案槽键自动派生，二进制响应在传输与 FFI 两层均不经过 UTF-8 或 JSON 数组 | 低（498 份官方请求体快照全量核对） | **推荐** |
| 删掉 | 删掉自定义调用 `saveFile` 或删掉未传 `modeId` 的容量前置护栏 | 中 | 删 `saveFile` 让只回字节流的上游无法接入；删容量护栏让超量参考白发上游报错 | 高 | 否 |

### 7. 用户要权衡的核心

无需用户额外权衡：修复后外部助手 / 无界面路径发送首尾两帧不再被误判为「最多收 1 张」，自定义脚本收二进制流不再损坏字节，既有 JSON 脚本与 498 份官方请求体逐字节不变。

## 特征测试清单（动结构前先锁住）

- `electron/parity/officialWire.matrix.test.ts`（498 份请求体指纹零漂移）
- `electron/shared/generationLowering/referencePlacement.characterization.test.ts`
- `electron/shared/generationLowering/referenceBinding.contract.test.ts`
- `electron/catalog/taskParams.modeInputRoutes.test.ts`
- `electron/catalog/customCallTextAndFile.test.ts`
- `electron/tasks/syncBytesResultLandsInProject.test.ts`
