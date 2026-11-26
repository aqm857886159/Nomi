// 「这一笔结果是一组图层」的唯一读法（图层分离，设计卡 docs/plan/2026-11-26-layer-split.md）。
//
// 不认供应商：线缆在 query 的 response_mapping 里声明图层描述在哪（`layers` = 描述列表，与产物地址列表按下标平行），
// 以及每条描述里叠放序 / 名字 / 摆放框 / 识别出的字各在哪（`layer_z_index` / `layer_name` / `layer_box` / `layer_text`，
// 相对一条描述的路径）。读出来的是通用形状 `TaskResultLayer`，渲染层只认它，不再读供应商原始响应。
import { firstString, isJsonRecord, type JsonRecord } from "../jsonUtils";
import { mappingCandidates, maybeParseJsonString, pathValues } from "./responseParsing";
import { retrievalStageError } from "./retrievalStageError";

/** 一层的通用描述（与 TaskResult.assets 按下标平行）。`box` 是底图像素坐标 [左, 上, 右, 下]；没有框 = 铺满底图（底图本身）。 */
export type TaskResultLayer = {
  zIndex: number;
  name?: string;
  text?: string;
  box?: { left: number; top: number; right: number; bottom: number };
};

function readBox(value: unknown): TaskResultLayer["box"] | undefined {
  const parsed = maybeParseJsonString(value);
  if (!Array.isArray(parsed) || parsed.length !== 4) return undefined;
  const [left, top, right, bottom] = parsed.map((item) => Number(item));
  if (![left, top, right, bottom].every((item) => Number.isFinite(item))) return undefined;
  if (right! <= left! || bottom! <= top!) return undefined;
  return { left: left!, top: top!, right: right!, bottom: bottom! };
}

function itemValue(item: unknown, mapping: JsonRecord, key: string): unknown {
  for (const path of mappingCandidates(mapping, key)) {
    const found = pathValues(item, path);
    if (found.length) return found[0];
  }
  return undefined;
}

/**
 * 读这份响应里的图层描述。线缆没声明 `layers`、或响应里没有这张列表 → null（不是图层结果，按普通产物落）。
 * 有列表就必须和产物地址一样多：对不上说明下标平行这条合同破了，按哪层摆都会摆错 → 抛错（调用方挂取回阶段，可找回）。
 */
export function readTaskLayers(response: unknown, responseMapping: JsonRecord | null, assetCount: number): TaskResultLayer[] | null {
  if (!responseMapping || !mappingCandidates(responseMapping, "layers").length) return null;
  const list = mappingCandidates(responseMapping, "layers")
    .flatMap((path) => pathValues(response, path))
    .map((value) => maybeParseJsonString(value))
    .find((value): value is unknown[] => Array.isArray(value));
  if (!list || !list.length) return null;
  if (list.length !== assetCount) {
    throw new Error(`layer list has ${list.length} entries but the result has ${assetCount} images`);
  }
  return list.map((item, index) => {
    const record = isJsonRecord(item) ? item : {};
    const zRaw = Number(itemValue(record, responseMapping, "layer_z_index"));
    const name = firstString(itemValue(record, responseMapping, "layer_name"));
    const text = firstString(itemValue(record, responseMapping, "layer_text"));
    const box = readBox(itemValue(record, responseMapping, "layer_box"));
    return {
      zIndex: Number.isFinite(zRaw) ? zRaw : index,
      ...(name ? { name } : {}),
      ...(text ? { text } : {}),
      ...(box ? { box } : {}),
    };
  });
}

/**
 * 成功那一份结果的图层（`buildProfileTaskResult` 唯一调用）：描述与读到的地址、落进项目的产物三者一样多才算数。
 * 对不上 = 下标平行这条合同破了 → 挂解析阶段（可找回，不判失败、不当普通多张落）。
 */
export function layersForLandedResult(response: unknown, responseMapping: JsonRecord | null, readUrlCount: number, landedCount: number): TaskResultLayer[] | null {
  if (!landedCount) return null;
  try {
    const layers = readTaskLayers(response, responseMapping, readUrlCount);
    if (layers && layers.length !== landedCount) throw new Error(`layer list has ${layers.length} entries but ${landedCount} images landed`);
    return layers;
  } catch (error) {
    throw retrievalStageError("retrieval-parse", error);
  }
}
