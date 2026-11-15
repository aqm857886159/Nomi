import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";

// 魔搭社区（ModelScope api-inference）图像档案 —— 官方原生接入。
// 与 apimart 的 z-image / qwen-image 档案的关键区别在 params：魔搭 size 必须是**像素 WxH**
// （真实 API 验证 2026-06-19：传 "16:9" 报 {"errors":{"message":"size format should be WxH"}}），
// 而 apimart 用比例串。这是不同 vendor 的不同契约，不是并行版（P4：身份/能力共享，params 分供应商）。
// 真实 E2E：Z-Image-Turbo / Qwen-Image-2512 文生图均已出图验证。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const SIZE_PARAM: ModelParameterControl = {
  key: "size",
  label: "尺寸",
  type: "select",
  options: opt(["1024x1024", "1280x720", "720x1280", "1024x768", "768x1024"]),
  defaultValue: "1024x1024",
};

export const MODELSCOPE_IMAGE_ARCHETYPE: ModelArchetype = {
  id: "modelscope-image",
  family: "modelscope",
  label: "魔搭图像",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  // 用魔搭命名空间形式（带斜杠），不与 apimart 的裸名 z-image / qwen-image 撞；
  // 且 seed 模型已显式带 archetypeId（resolveModelArchetype 显式优先），这里只是给用户自接同名模型兜底。
  // ⚠️ 匹配是严格相等不是前缀：只写 "black-forest-labs/flux" 这类前缀形永远匹配不到真实 key，
  // 必须列完整 key（seededModelIdentity.test 会红）。前缀项保留——对同名裸模型仍有意义。
  identifierPatterns: [
    "tongyi-mai/z-image", "qwen/qwen-image-2", "black-forest-labs/flux", "modelscope",
    "Tongyi-MAI/Z-Image-Turbo", "Tongyi-MAI/Z-Image", "Qwen/Qwen-Image-2512",
    "black-forest-labs/FLUX.2-klein-9B", "black-forest-labs/FLUX.1-Krea-dev", "MAILAND/majicflus_v1",
  ],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "魔搭极速文生图",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params: [SIZE_PARAM],
    },
  ],
};

// 魔搭改图档案（Qwen-Image-Edit）。给图 + 提示词改图——真实 E2E 验证（2026-06-19）：
// 输入图走 image_url（data URL 数组，vendor inline-base64 ingestion）。输出尺寸跟随输入图，故无 size 参数。
export const MODELSCOPE_IMAGE_EDIT_ARCHETYPE: ModelArchetype = {
  id: "modelscope-image-edit",
  family: "modelscope",
  label: "魔搭改图",
  kind: "image",
  defaultModeId: "edit",
  transportTaskKind: "image_edit",
  identifierPatterns: ["qwen/qwen-image-edit", "modelscope-edit", "Qwen/Qwen-Image-Edit-2511"],
  modes: [
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图 + 提示词改图",
      promptRequired: true,
      transportTaskKind: "image_edit",
      // 输入图槽 → request.params.image_url（魔搭 body 字段名），inline-base64 转 data URL 后铺进 body。
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 4, inputKey: "image_url" }],
      params: [],
    },
  ],
};
