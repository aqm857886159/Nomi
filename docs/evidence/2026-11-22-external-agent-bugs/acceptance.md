V-external-agent-bugs：通过

- 验收线：V-external-agent-bugs
- 实现线：i-repro-and-fix
- 验收 HEAD：503fcea1b36bc145bf86ab42f0d6a921ea237d6c
- 验收分支：`fix/external-agent-ref-cap-and-bytes`（PR #1609，对照 `origin/main` 核验全部 17 个改动文件）
- 结论摘要：PR #1609 的两项修复（未传 `modeId` 时按同 `taskKind` 匹配方式聚合参考图容量上限 + 内置档案独占首尾帧槽键自动派生；`customCall` HTTP 响应按 RFC 9110 `Content-Type` 解码与 QuickJS 原生 `ArrayBuffer` 双向二进制过桥）均经独立实跑测试、3 项反例破坏验证与单主人边界核查确认通过，无未解除阻断。

## 1. 独立实跑命令与结果汇总

### 1.1 核心回归与全目录单测（7 文件，309/309 通过）
命令：
```bash
npx vitest run \
  electron/catalog/taskParams.modeInputRoutes.test.ts \
  electron/catalog/taskParams.test.ts \
  electron/vendor/vendorHttp.test.ts \
  electron/catalog/customCallRunner.test.ts \
  electron/catalog/customCallTextAndFile.test.ts \
  electron/catalog/customCallFalQueueFixture.test.ts \
  electron/tasks/syncBytesResultLandsInProject.test.ts
```
输出摘要：
- `electron/catalog/taskParams.test.ts`：97/97 通过
- `electron/vendor/vendorHttp.test.ts`：33/33 通过
- `electron/catalog/customCallFalQueueFixture.test.ts`：1/1 通过
- `electron/catalog/customCallRunner.test.ts`：18/18 通过
- `electron/catalog/customCallTextAndFile.test.ts`：7/7 通过（含非 UTF-8 MP4 `0x80 0xff 0xfe 0x00 0xde 0xad 0xbe 0xef 0xc3 0x28 0xa0 0xa1`、`FormData` 上传直返二进制流、HTTP 200 `{ code: 401 }` 逻辑错误拦截）
- `electron/tasks/syncBytesResultLandsInProject.test.ts`：132/132 通过（含上游直回 `audio/mpeg`、`video/mp4` 二进制媒体流落入项目资产库与逐字节比对）
- `electron/catalog/taskParams.modeInputRoutes.test.ts`：21/21 通过（扫全目录 917 格；`others` 异常白名单确已清零为 `[]`；`doubao-seedance-2.5`、`wan3.0-video`、`wan3.0-video-prime` 无 `modeId` 发送首尾两帧在引擎 A 与引擎 B 全部放行且超限 3 张照常拒发；`kie/bytedance/seedance-2-5` 继承 `transportTaskKind` 命中 `source: "model-declaration"`）
- 注：仓库中不存在 `electron/shared/modelArchetypes/referenceKeys.test.ts`，其覆盖由 `referenceKeyProjectionCensus.test.ts`、`taskParams.modeInputRoutes.test.ts`、`frameSwapKeepsSendable.exhaustive.test.ts` 与 `officialWire.matrix.test.ts` 承担，均已独立实跑通过。

### 1.2 档案矩阵、特征锁与老用户升级路径（8 文件，464/464 通过）
命令：
```bash
npx vitest run \
  electron/catalog/referenceKeyProjectionCensus.test.ts \
  electron/parity/officialWire.matrix.test.ts \
  electron/shared/modelArchetypes/seedance25ApimartWire.test.ts \
  electron/shared/modelArchetypes/wan30.test.ts \
  electron/shared/modelArchetypes/frameSwapKeepsSendable.exhaustive.test.ts

npx vitest run \
  electron/catalog/upgradeKeepsWorkingModels.test.ts \
  electron/shared/generationLowering/referencePlacement.characterization.test.ts \
  electron/shared/generationLowering/referenceBinding.contract.test.ts
```
输出摘要：
- `electron/parity/officialWire.matrix.test.ts`：281/281 通过
- `electron/shared/modelArchetypes/frameSwapKeepsSendable.exhaustive.test.ts`：94/94 通过
- `electron/shared/modelArchetypes/wan30.test.ts`：20/20 通过
- `electron/shared/modelArchetypes/seedance25ApimartWire.test.ts`：4/4 通过
- `electron/catalog/referenceKeyProjectionCensus.test.ts`：14/14 通过
- `electron/catalog/upgradeKeepsWorkingModels.test.ts`：10/10 通过
- `electron/shared/generationLowering/referencePlacement.characterization.test.ts`：25/25 通过
- `electron/shared/generationLowering/referenceBinding.contract.test.ts`：16/16 通过

### 1.3 独立 `0x00..0xff` 全字节域 JPEG / MP4 跨 QuickJS 沙盒保真探针
使用本机 `127.0.0.1` 回环 HTTP 服务返回含完整 256 字节值域（`0x00..0xff`，覆盖全部高位非 UTF-8 字节 `0x80..0xff` 与 NUL `0x00`）的 `image/jpeg`（264 字节）与 `video/mp4`（264 字节）负载，经 `runCustomCallScript` 的 `http.get` 进入 QuickJS 沙盒校验 `bytes instanceof Uint8Array` 与长度后再经 `saveFile` 传回主进程逐字节比对：
- `jpeg: len=264/264 compare=0 preview=Uint8Array(264 bytes)`
- `mp4: len=264/264 compare=0 preview=Uint8Array(264 bytes)`
确认跨 QuickJS 沙盒双向传递零字节损坏、零长度膨胀、日志预览无乱码。

### 1.4 门岗与静态合约校验
- `node ./scripts/check-concept-owners.mjs`：通过（392 个概念，第二写口 0 新增，`generation.headless-reference-key-projection` 与 `catalog.custom-call-http-response` 均合规）
- `node ./scripts/check-root-cause-contracts.mjs`：通过（5 个高风险生产文件均有合同和变化中的回归测试）
- `node ./scripts/check-builtin-vendor-literals.mjs`：通过（扫 5376 个文件，新增违规 0）
- `pnpm run check:i18n`：通过（22/22 门岗单测通过，6622 键中英同步，electron 文案基线只减不增从 2 降至 1）
- `node scripts/lint-changed.mjs`：通过（11 个改动文件，错误 0，警告不比 `origin/main` 多）

## 2. 独立反例破坏验证（验证测试真能拦住回归）

全部 3 项破坏测试均在隔离工作树中手工注入故障、实跑确认变红后立即 `git checkout -- .` 恢复干净：

1. **反例 1（破坏无 `modeId` 容量聚合）**：
   - 破坏手法：将 `electron/shared/modelArchetypes/referenceKeys.ts` 中 `!selectedMode` 分支由取匹配方式 `Math.max` 改回直接早退 `return declarations[0]!`。
   - 实跑命令：`npx vitest run electron/catalog/taskParams.modeInputRoutes.test.ts -t "无 modeId"`
   - 实跑结果：**必红（exit code 1，3 failed）**——`doubao-seedance-2.5`、`wan3.0-video`、`wan3.0-video-prime` 全部当场复现报错 `{"code":"Error","message":"这个模型最多收 1张图片参考。"}`。
2. **反例 2（破坏独占首尾帧槽键从内置档案自动派生）**：
   - 破坏手法：将 `electron/shared/modelArchetypes/referenceKeys.ts` 的 `referenceFrameKindFor` 改回仅查静态表 `STATIC_FRAME_REFERENCE_KEYS`。
   - 实跑命令：`npx vitest run electron/catalog/taskParams.modeInputRoutes.test.ts -t "按 mapping body 发"`
   - 实跑结果：**必红（exit code 1，1 failed）**——`expect(others).toEqual([])` 立刻捕获 `["higgsfield/higgsfield-ai/dop/standard/firstlast", "higgsfield/higgsfield-ai/dop/turbo/firstlast"]`。
3. **反例 3（破坏 QuickJS 二进制响应，改回 UTF-8 字符串解码）**：
   - 破坏手法：将 `electron/catalog/customCallRunner.ts::decodeCustomCallHttpResponse` 末尾 `return bytes;` 改回 `return bytes.toString("utf8");`。
   - 实跑命令：`npx vitest run electron/catalog/customCallTextAndFile.test.ts electron/tasks/syncBytesResultLandsInProject.test.ts -t "binary|裸字节"`
   - 实跑结果：**必红（exit code 1，2 failed）**——分别报错 `CustomCallScriptError: Error: expected Uint8Array, got string` 与 `CustomCallScriptError: TypeError: saveFile bytes 必须是 ArrayBuffer、Uint8Array 或数字数组`。

## 3. 代码边界、唯一 Owner 与保护出口核查

- **唯一 owner**：
  - 参考键容量声明与首尾帧意图唯一收口在 `electron/shared/modelArchetypes/referenceKeys.ts`（`referenceKeyCapacityDeclarationFor` 复用 `modeTransportFor`，`FRAME_REFERENCE_KEYS` 从 `everyBuiltInArchetype()` 派生并排除通用多图键与角色对象键），`electron/catalog/taskParamsReferences.ts::hasImageEditReferences` 通过共享 `classifyReferenceKey` 判定，未新增第二套键表。
  - `customCall` HTTP 传输唯一收口在 `electron/vendor/vendorHttp.ts::requestBinary`（同时支持 `FormData` 并剥离手动 `content-type` 让 fetch 生成 boundary），按媒体类型解码唯一收口在 `electron/catalog/customCallRunner.ts::decodeCustomCallHttpResponse`，主进程 ↔ QuickJS 二进制过桥唯一收口在 `electron/catalog/customCallSandbox.ts`（`newArrayBuffer` / `getArrayBuffer`）。
- **无新增供应商或模型硬编码分支**：逐行核查全部 `git diff origin/main...HEAD -- electron/ src/`，生产代码中零模型名、零供应商名特例分支，且 `check-builtin-vendor-literals.mjs` 实跑确认新增违规为 0。
- **保护出口与既有约束**：显式传 `modeId` 时仍按单方式严格判定；超模型最大参考图上限（如首尾双帧模型传 3 张）仍于发请求前由 `modelConstraints.imageReferenceCapacity` 拦截、0 出网；HTTP 4xx/5xx 与 HTTP 200 `{ code: 4xx/5xx }` 逻辑错误信封拦截、沙盒 64MB 内存上限与超时中断均保持不变。
