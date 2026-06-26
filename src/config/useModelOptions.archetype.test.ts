import { describe, it, expect } from "vitest";
import type { ModelCatalogModelDto } from "../workbench/api/modelCatalogApi";
import { parseModelParameterControls } from "./modelCatalogMeta";
import { toCatalogModelOptions } from "./useModelOptions";

// 渲染层接线：toCatalogModelOptions 对「认得的模型」把档案控件注入 meta.parameterControls，
// 现有渲染路径(parseModelParameterControls)不变就能渲染档案控件。供应商无关；认不出不注入。

function model(partial: Partial<ModelCatalogModelDto>): ModelCatalogModelDto {
  return { modelKey: "", vendorKey: "v", modelAlias: null, labelZh: "L", kind: "video", enabled: true, ...partial } as ModelCatalogModelDto;
}

describe("toCatalogModelOptions — 认得的模型注入内置档案控件", () => {
  it("Seedance（仅靠 modelKey 身份命中、无 meta）→ 渲染出档案的 比例/清晰度/时长/音频", () => {
    const [opt] = toCatalogModelOptions([model({ modelKey: "bytedance/seedance-2" })]);
    const controls = parseModelParameterControls(opt.meta);
    expect(controls.map((c) => c.key)).toEqual(["resolution", "aspect_ratio", "duration", "generate_audio"]);
    const resolution = controls.find((c) => c.key === "resolution");
    expect(resolution?.options.map((o) => o.value)).toEqual(["480p", "720p", "1080p", "4k"]);
    expect(resolution?.defaultValue).toBe("720p");
  });

  it("供应商无关：经任意中转站接入(不同 vendorKey)同样注入", () => {
    const [opt] = toCatalogModelOptions([model({ modelKey: "seedance-2", vendorKey: "my-own-relay" })]);
    expect(parseModelParameterControls(opt.meta).map((c) => c.key)).toEqual([
      "resolution",
      "aspect_ratio",
      "duration",
      "generate_audio",
    ]);
  });

  it("认不出的模型 → meta 不被注入（走现有通用解析，无控件）", () => {
    const [opt] = toCatalogModelOptions([model({ modelKey: "acme/unknown-video" })]);
    expect(parseModelParameterControls(opt.meta)).toEqual([]);
  });
});
