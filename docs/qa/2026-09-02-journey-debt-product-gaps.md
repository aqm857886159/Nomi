# 旅程债返工中扫出的产品缺口（记录上报，不顺手修）

> 2026-09-02，journeys/debt-rework-20260902。按任务纪律：改动预算=旅程/夹具/文档；
> 产品真 bug 记录+上报，立项归编排者。两个缺口都有旅程探针 + 源码 file:line 双证。

## 缺口① 已适配平台（apimart/kie 之外）存 key 后无任何验证/晋级入口 → 用户死路

复现（隔离 profile，RunningHub，2026-09-02 探针）：

1. 模型设置首页 → RunningHub 行 → 连接页填 key → 解锁。
2. `rendererCatalogMutation.ts:140-147`（设计如此）把凭证写成 disabled-pending-certification，
   并把 vendor 降级 `enabled:false`，等「canonical certification run」晋级。
3. 但晋级入口只给了两家：`src/ui/onboarding/onboardingDrawerConnections.ts:172-174` 只有
   `['apimart','kie']` 被路由到 `platformConnect`（KnownVendorKeyConnectPage，带「安全保存并
   继续验证」→ openWizard → 验证晋级）；其余已适配平台（runninghub 等）走 `connection` 页 ——
   该页只有 更换/断开/修改地址，**没有任何验证入口**。
4. 模型详情页的「后台自动适配」也不是晋级路：实测点击后 90 秒内上游只收到一次 `GET /models`，
   vendor 始终 `enabled:false`。
5. 结果状态自相矛盾：连接页显示「已连通 · 13 个模型可用」，模型详情显示「可以使用，尚未测试」，
   画布 3D/图片/视频节点的模型列表却因 `selectExecutableModel` 要求 `vendor.enabled`
   （`electron/catalog/executableModel.ts:15-16`）而不出现这些模型（3D 节点显示
   「模型目录配置不完整 · 去配置 →」）。用户没有任何 UI 动作能走出这个状态。

注：`sanitizeRendererVendorMutation`（`rendererCatalogMutation.ts:53-57`）明确允许
「有 published execution 模型的 vendor」被 renderer 启用——种子模型（无 adapter meta、带
enabled mappings）满足 `modelHasPublishedExecution`。也就是说合法状态迁移存在，缺的只是
一个 UI 控件/路由。J11 旅程在此用一次 `upsertVendor({key:'runninghub',enabled:true})` 作
**脚手架**绕过（注释里注明缺口编号），不代表缺口已修。

## 缺口② 画布 3D 模型节点的生成派发被硬挡：canRunGenerationNode 无 model3d 分支

复现（缺口①绕过后，Meshy 6 已可选、提示词/参数齐全）：

- 生成按钮恒禁用；runner 侧同一谓词直接抛「暂不支持 model3d 类型节点的生成」。
- 出处：`src/workbench/generationCanvas/runner/generationRunController.ts:694-736`
  （image/text/audio/video 各有分支，其余 kind 落到 `return false`）与
  `:251-257`（派发口用同一谓词并抛「暂不支持」）。
- 与之矛盾的既有意图：`electron/catalog/runninghub3d.ts:1-3`「让画布 model3d 节点有真实
  可选模型」；`electron/catalog/catalogCommit.ts:540-543`「3D 只登记身份、等有通道那天这些
  条目直接能用」。通道（runninghub 种子 create-poll mapping）已经有了，派发层没接。

影响：任何直连 3D 供应商（RunningHub 混元3D/HiTem3D/Meshy 6）即使解决缺口①，画布上也
出不了 GLB。J11 旅程因此以 `JourneyBlocked('canvas-3d-dispatch-unsupported')` 收尾（BLOCKED
≠ FAIL；填充态选择器截图与边界证据已在旅程 evidence 里）。旅程里写了升级探针：若产品补上
model3d 派发（按钮变可用），J11 会自动改走完整闭环并要求真实 wire + GLB 渲染，不会留假 BLOCKED。

## 缺口③（顺带记录）中转「测试连接」成功文案在零模型时用词失真

reachability-only 成功文案 `modelSetup.connectedReachabilityOnly`：「地址和 Key 没问题 ·
**你选的都是图片 / 视频模型**…」。在一个模型都没选时也显示这句（J04 探针 2026-09-02），
「你选的都是…」与实际状态不符。语义仍诚实（要真跑一次才知道），只是措辞前提错。小文案病，
随缺口①②一并立项时顺手裁决。
