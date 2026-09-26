# 落盘素材名保住扩展名（N4b，v0.22.1）

> 状态：✅ 已实现（09-26 协调会话收尾：上一个会话留下的未提交实现 + 本会话补验证、合同）
> 根因合同：[2026-09-26-asset-name-keeps-extension.root-cause.json](../fixes/2026-09-26-asset-name-keeps-extension.root-cause.json)

## 用户那一刻卡在哪

Agent 付费卡生成的视频，在画布上点「下载」存成 `.bin`，Windows 双击打不开。App 里照样能播（类型靠嗅字节），所以在 App 里看不出问题。

## 根因

`sanitizeName` 把**整个文件名**截到 90 字。供应商出片地址的 basename 很长（签名段、哈希段），扩展名跟着被截掉；两条写盘路径各自 `path.parse` 后退回 `.bin`。
data: URL 还会把 base64 正文的一截当成文件名。

## 先查别人

- **依赖里已有？** Node 的 `path.parse`（`node_modules/@types/node/path.d.ts:160`）只拆名字，不管长度预算。仓库自己的 `canonicalAssetFileName`（`electron/assets/assetPaths.ts:24`）已经按嗅出的类型换扩展名，本次复用它，不再写一份。
- **仓库里已有？** 内容寻址上传 `electron/assets/uploadContentStore.ts:43` 用原始 basename、不截断，扩展名一直保得住；缓存文件 `electron/assets/projectCacheFile.ts:20` 的名字本来就很短。
- **生态里已有？** 「扩展名从内容类型推出来」是通用做法，例如 jshttp/mime-types 的 `mime.extension(type)`：https://github.com/jshttp/mime-types#mimeextensiontype 。「只截主干、保住扩展名」这一步我们自己写，因为长度预算（90 字）是我们自己的约束。
- **TikHub 自媒体里怎么说？** 不适用：这是内部落盘命名，用户侧只看到「下载的文件打不开」。
- **结论**：在 `projectAssetStore` 里收一个唯一的命名函数 `storedAssetFileParts`，不引依赖。

## 范围

- `electron/assets/projectAssetStore.ts`：`storedAssetFileParts` 成为落盘名唯一裁法（扩展名取嗅出的类型、只截主干），`uniqueAssetPath` 与 `writeDeterministicAsset` 改用它，各自的 `|| '.bin'` 删掉。
- `electron/projects/repository.ts`：导出长度上限 `SANITIZED_NAME_MAX_LENGTH`，并注明 `sanitizeName` 不认扩展名。
- `electron/capabilityCore/generationOutputMaterializer.ts`：data: URL 不再取 basename。
- 测试：单测改用真实的 `sanitizeName`（以前被 mock 成不截断，所以一直测不出来）；新走查 `agent-spend-long-output-name`（loopback + 只记账不放行的出口代理，零花费）。

## 不动

- 显示名、项目文件夹名的截断（它们没有扩展名语义）；内容寻址上传的命名。

## 验收

- 单测：8 条长名 / data: URL 用例在旧代码上全红，修后全绿；assets + materializer + projects 共 284 条通过。
- 走查（Windows 真机）：148 字出片地址落盘为 `seedance-output-…-<键>.mp4`；画布「下载」在中文和英文界面默认名都是 `镜头 1.mp4`；任务期间打向供应商主机的请求为零。

## 回滚

单个 revert；已经落成 `.bin` 的旧文件不迁移（App 内照常能用）。
