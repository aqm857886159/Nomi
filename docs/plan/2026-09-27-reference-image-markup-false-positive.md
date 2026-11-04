# 参考图标记误判修复计划（2026-09-27）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 范围

- 在 `electron/assets/mediaTypes.ts` 统一 `isMarkupMasquerade` 与扫描窗口，判定只看去 BOM、前导空白后的文件开头。
- `assetLocalization`、`projectAssetStore`、`certificationMedia` 统一消费该 owner；栅格魔数优先，保留声明与魔数一致性检查及 SVG 结构校验。
- 本地素材读取失败、未知类型、伪装文本统一打 `asset-invalid`，渲染层按机器码归类并补 zh-CN/en 文案。
- 补 C2PA `caBX`、PNG XMP、JPEG APP1 XMP 与文本反例测试。

## 先查别人（R27；报告见 [`docs/research/2026-09-28-reference-image-markup/prior-art.md`](../research/2026-09-28-reference-image-markup/prior-art.md)）

- **依赖里已有？** Node 的 `TextDecoder` 已是运行时能力，仓库现有 `electron/assets/mediaTypes.ts:25` 也已经拥有字节魔数判定；本次复用它们，不新增依赖或第二套解码器。结论：用已有。
- **仓库里已有？** `contentTypeFromMagicBytes`（`electron/assets/mediaTypes.ts:25`）和认证/落盘边界（`electron/providerAdapter/certificationMedia.ts:218`、`electron/catalog/assetLocalization.ts:180`）已经消费同一媒体类型表；本次把伪装文本判断收进同一 owner，沿用这些边界而不是在调用方复制正则。结论：收敛到已有 owner。
- **生态里已有？** C2PA 规范（https://c2pa.org/specifications/specifications/2.1/specs/C2PA_Specification.html）说明 PNG 的 `caBX` JUMBF 元数据可携带图标，W3C PNG 规范（https://www.w3.org/TR/png-3/#11iTXt）说明 iTXt 可承载 XMP，WHATWG MIME sniffing（https://mimesniff.spec.whatwg.org/#identifying-a-resource-with-an-unknown-mime-type）只从资源开头匹配标记。结论：按规范只查开头并让栅格魔数优先。
- **TikHub 自媒体里怎么说？** 没找到能替代二进制格式规范、且可复核的同类实现；这不是产品教程问题，不把不可复核的帖子当判据。结论：不采用，保留官方规范出处。

## 不动项

不改上传通道、付费守卫、声明与魔数一致性语义，不新增第二个图片判据，不改其它 UI。

## 概念占用表

| 概念 | 唯一 owner | 允许消费 |
|---|---|---|
| 字节是不是伪装成媒体的标记/错误体 | `electron/assets/mediaTypes.ts` `isMarkupMasquerade` | assetLocalization、projectAssetStore、certificationMedia |
| 本地素材错误的机器码 | `electron/shared/nomiErrorCodes.ts` | assetLocalization（打标）、classifyError（归类） |

## 回滚

删除本次共享 owner、调用方接线、`asset-invalid` 码/文案、测试和本计划/合同即可回到修复前；不涉及数据迁移。

## 验收门

- mediaTypes/assetLocalization、projectAssetStore、certificationMedia 与 classifyError 相关测试通过。
- 锚定开头的 PNG `caBX`、PNG iTXt XMP、JPEG APP1 XMP 均不误判；HTML/XML/SVG 文本仍拒绝，SVG 仍做结构校验。
- 去掉 owner 正则 `^` 时上述元数据回归测试必须失败。
- `node scripts/door-map.mjs isMarkupMasquerade assertLocalAssetMediaBytes validatedGeneratedMeta` 输出的 5 扇门写入根因合同。
- `check:root-cause-contracts`、相关门岗和 typecheck 由主管在可启动子进程的环境执行。
