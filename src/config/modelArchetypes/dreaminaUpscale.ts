// 即梦官方 dreamina CLI 的图片超清档案（image_upscale）。官方 `-h`：单张本地图输入，
// resolution_type 2k/4k/8k（2k 免费，4k/8k 需 VIP）。无 model_version、无 prompt。
// 单列档案（不并入 dreaminaImage 的 i2i）：避免同 (vendor, image_edit, modelKey) 两条 mapping 撞车。
import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

export const DREAMINA_UPSCALE_ARCHETYPE: ModelArchetype = {
  id: "dreamina-upscale",
  family: "dreamina-image",
  label: "即梦图片超清",
  kind: "image",
  defaultModeId: "upscale",
  transportTaskKind: "image_edit",
  identifierPatterns: ["dreamina-upscale"],
  modes: [
    {
      id: "upscale",
      intent: "edit",
      vendorTerm: "图片超清",
      hint: "把一张图放大到 2k/4k/8k（4k/8k 需高级会员）",
      promptRequired: false,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 1, inputKey: "input_image" }],
      params: [
        { key: "resolution_type", label: "清晰度", type: "select", options: opt(["2k", "4k", "8k"]), defaultValue: "2k" },
      ],
    },
  ],
};
