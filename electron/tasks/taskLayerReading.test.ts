// 图层结果的唯一读法：线缆声明在哪，就从哪读；不声明 / 响应里没有 = 不是图层结果；条数对不上 = 挂解析阶段（可找回）。
// 反例：把下标平行的核对删掉 → 「条数对不上就挂解析阶段」红；把底图当成有框的层 → 「底图没有框」红。
import { describe, expect, it } from "vitest";
import { APIMART_IMAGE_QUERY_OP } from "../catalog/apimartVendor";
import { matchNomiErrorCode } from "../shared/nomiErrorCodes";
import { layersForLandedResult, readTaskLayers } from "./taskLayerReading";

const mapping = APIMART_IMAGE_QUERY_OP.response_mapping as Record<string, unknown>;

function response(layers: unknown[], urls: string[]) {
  return { data: { status: "completed", result: { images: [{ url: urls, layers }] } } };
}

const base = { z_index: 0, name: "背景" };
const title = { z_index: 2, name: "标题文字", bounding_box: { absolute: [10, 20, 310, 120] }, text_recognition: { text: "夏日限定" } };
const cup = { z_index: 1, bounding_box: { absolute: [400, 300, 700, 900] } };

describe("readTaskLayers（图层结果的通用形状）", () => {
  it("按 APIMart 查询线缆声明的路径读：叠放序、名字、框（底图像素）、识别出的字；底图没有框", () => {
    const layers = readTaskLayers(response([base, title, cup], ["u0", "u1", "u2"]), mapping, 3);
    expect(layers).toEqual([
      { zIndex: 0, name: "背景" },
      { zIndex: 2, name: "标题文字", text: "夏日限定", box: { left: 10, top: 20, right: 310, bottom: 120 } },
      { zIndex: 1, box: { left: 400, top: 300, right: 700, bottom: 900 } },
    ]);
  });

  it("线缆不声明 layers、或响应里没有列表 → null（按普通产物落）", () => {
    expect(readTaskLayers(response([base], ["u0"]), { ...mapping, layers: undefined }, 1)).toBeNull();
    expect(readTaskLayers({ data: { result: { images: [{ url: ["u0"] }] } } }, mapping, 1)).toBeNull();
    expect(readTaskLayers(response([base], ["u0"]), null, 1)).toBeNull();
  });

  it("框写坏了（不是 4 个数 / 右不大于左）→ 这一层没有框，不猜位置", () => {
    const broken = [base, { z_index: 1, bounding_box: { absolute: [10, 10, 5, 40] } }, { z_index: 2, bounding_box: { absolute: [1, 2, 3] } }];
    const layers = readTaskLayers(response(broken, ["u0", "u1", "u2"]), mapping, 3)!;
    expect(layers.map((layer) => layer.box)).toEqual([undefined, undefined, undefined]);
  });

  it("没有叠放序 → 用下标（不丢层）", () => {
    const layers = readTaskLayers(response([{}, { name: "杯子" }], ["u0", "u1"]), mapping, 2)!;
    expect(layers.map((layer) => layer.zIndex)).toEqual([0, 1]);
  });

  it("条数对不上就挂解析阶段（可找回），不当普通多张落", () => {
    expect(() => readTaskLayers(response([base, title], ["u0", "u1", "u2"]), mapping, 3)).toThrow(/2 entries/);
    let thrown: unknown;
    try { layersForLandedResult(response([base, title, cup], ["u0", "u1", "u2"]), mapping, 3, 2); } catch (error) { thrown = error; }
    expect(matchNomiErrorCode((thrown as Error).message)).toBe("retrieval-parse");
  });

  it("一张都没落进项目 → 不报图层（结果按失败 / 找回走，不在这里判）", () => {
    expect(layersForLandedResult(response([base, title], ["u0", "u1"]), mapping, 2, 0)).toBeNull();
  });
});
