import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

// Seedance 2.5 档案。契约逐项对账自**三家官方入口**（2026-08-30 复核）：
//   - kie:     docs.kie.ai/market/bytedance/seedance-2-5 · POST /api/v1/jobs/createTask
//              input.reference_image_urls / reference_video_urls / reference_audio_urls = 30 / 10 / 10
//   - apimart: docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation · POST /v1/videos/generations
//              （原 /cn/.../doubao-seedance-2-5 已 404，2026-08-20 复核后更新为现行路径；30/10/10 未变）
//              image_urls / video_urls / audio_urls = 30 / 10 / 10（另有 image_with_roles 表达首尾帧）
//   - runway:   docs.dev.runwayml.com/guides/models/ + Runway OpenAPI · POST /v1/text_to_video 或
//              /v1/image_to_video，model=seedance2_5；references/referenceVideos/referenceAudio =
//              typed URI objects（mapping request_transform 负责 wire 形状转换）。
//
// ⚠️ 2026-08-12 修正：此前写 9 图 / 3 视频 / 3 音频、比例默认 16:9——**两处都不是文档里的数**，
// 是我们自己填的，等于把模型能力掐窄了（用户要连多段 3D 白膜做分镜时直接卡住）。
// 教训：注释写「已逐项对账」不等于真对过；数字类契约要么附文档原文出处，要么别声称对过。
//
// 白膜（3D blockout）：两家文档都**没有**白膜专用字段。ByteDance 宣传的「首个 3D 白盒预览」是
// 工作流卖点（Blender/Maya 插件导出预览），落到 API 就是当参考图 / 参考视频喂进来 —— 不需要新槽。
//
// 未落地的差异（等接 apimart 2.5 时一并处理，别现在塞进共享档案）：
//   - apimart 文档明确：首尾帧模式与「参考+编辑类」提示词下 size **必须** adaptive；kie 文档没提。
//     这是供应商级约束，该走 mode.vendorParams[apimart]，不是改共享档案（P4：身份形状不分供应商）。
//   - duration = -1（自动，按 30s 预扣后退差价）两家都支持，但当前 number 控件 min=4 表达不了。
//   - apimart 独有 watermark / seed / tools[web_search]；kie 独有 nsfw_checker / web_search。
//
// 与 2.0 的关键差异（独立档案、非 2.0 变体——版本级身份，canonical 纪律）：
//   - 时长 4–30 秒（30s 长片是 2.5 核心卖点；kie 官方示例 duration=15，Runware 文档 4-30）。
//   - resolution 仅 480p/720p：kie API 示例只有 720p；Apiframe 明确「1080p / 4k output is not
//     available upstream」。kie 营销页宣称 4K 与 API 面矛盾 → 按可调用的保守集放 480p/720p，
//     待真机验证高档后再放。
//   - 新增 return_last_frame（返回尾帧图，2.5 独有，2.0 无）。
//   - kie 2.5 文档明确「图生视频-首帧 / 图生视频-首尾帧 / 多模态参考生视频 3 种互斥，不可混用」
//     ——与我们档案的模式互斥结构（M2 投影）天然一致。
//   - kie 2.5 的 reference_video_urls **无尾随空格**（2.0 的 ␣ quirk 已在 2.5 文档修复——
//     逐字符照抄 2.5 文档，不继承 2.0 的坑）。
//   - 首尾帧字段名 first_frame_url/last_frame_url 沿用 2.0 同平台契约（2.5 文档示例未展示
//     图生视频字段名——已标注，真机验证后如有出入以实测为准）。

const toOptions = (values: string[]): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "resolution", label: "清晰度", type: "select", options: toOptions(["480p", "720p"]), defaultValue: "720p" },
  {
    key: "aspect_ratio",
    label: "比例",
    type: "select",
    options: toOptions(["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
    // 两家官方文档都写 default=adaptive（kie input.aspect_ratio、apimart size/aspect_ratio）。
    // 曾默认 16:9——那是我们自己填的，两边文档都没这么说。
    defaultValue: "adaptive",
  },
  { key: "duration", label: "时长", type: "number", options: [], min: 4, max: 30, defaultValue: 5 },
  // key 对齐 kie input 键 generate_audio / return_last_frame，控件值直接流到请求体（避免键名漂移）。
  { key: "generate_audio", label: "生成音频", type: "boolean", options: [], defaultValue: true },
  { key: "return_last_frame", label: "返回尾帧", type: "boolean", options: [], defaultValue: false },
  // 刻意不加 output_format（mp4/mov）：两家文档都支持，但 kie mapping 的 create.body 里没有这个键，
  // 加了控件用户选 mov 也还是出 mp4 = 死控件（设计系统 C1「可点即有效」）。
  // 要加得连 electron/catalog/kieSeedance25.ts 的 body 和存量用户的 mapping 一起改，另开一件。
];

export const SEEDANCE_2_5_ARCHETYPE: ModelArchetype = {
  id: "seedance-2.5",
  family: "seedance",
  label: "Seedance 2.5",
  kind: "video",
  sources: [
    {
      url: "https://docs.kie.ai/market/bytedance/seedance-2-5",
      checkedAt: "2026-08-12",
      vendorKey: "kie",
      covers: "POST /api/v1/jobs/createTask；input.reference_image_urls/_video_/_audio_ 上限 30/10/10；aspect_ratio 默认 adaptive；首尾帧与多模态参考互斥",
    },
    {
      // 原 /cn/api-reference/videos/doubao-seedance-2-5 已 404（2026-08-20 复核），文档搬到这个路径。
      url: "https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation",
      checkedAt: "2026-08-20",
      vendorKey: "apimart",
      covers: "POST /v1/videos/generations；image_urls/video_urls/audio_urls 上限 30/10/10；image_with_roles 表首尾帧；首尾帧与参考编辑类提示词下 size 必须 adaptive",
    },
    {
      url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json",
      checkedAt: "2026-08-30",
      vendorKey: "runway",
      covers: "Runway OpenAPI v2024-11-06：seedance2_5 文生/图生视频，duration 4–30，references 最多 30 图、referenceVideos 最多 10 个、referenceAudio 最多 10 个",
    },
  ],
  // 默认进文生视频，与 Seedance 2.0 / apimart / RunningHub 一致（P4 通用第一）。
  defaultModeId: "t2v",
  transportTaskKind: "image_to_video",
  identifierPatterns: ["bytedance/seedance-2-5", "seedance-2-5", "seedance-2.5", "seedance2.5", "seedance25"],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字描述生成视频，最长 30 秒",
      promptRequired: true,
      slots: [],
      params: PARAMS,
      transportTaskKind: "text_to_video",
    },
    {
      id: "first",
      intent: "single",
      vendorTerm: "首帧",
      hint: "单张首帧图驱动生成",
      promptRequired: true,
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1 }],
      params: PARAMS,
    },
    {
      id: "firstlast",
      intent: "firstlast",
      vendorTerm: "首尾帧",
      hint: "首帧 + 尾帧，过渡更可控",
      promptRequired: true,
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1 },
        { kind: "last_frame", label: "尾帧", min: 1, max: 1 },
      ],
      params: PARAMS,
    },
    {
      // 多模态参考：kie 文档示例实证 reference_image_urls / reference_video_urls / reference_audio_urls
      // （无尾随空格）。槽默认 inputKey 与文档键同名 → 不覆盖。
      id: "omni",
      intent: "character",
      vendorTerm: "全能参考",
      // 白膜（Blender/Maya 导出的无材质预览）就走这里——两家官方文档都没有白膜专用字段，
      // 它当参考图或参考视频喂进去即可（2026-08-12 逐项对账 kie + apimart 文档确认）。
      hint: "多模态参考；最多 30 图 / 10 视频 / 10 音频，3D 白膜当参考图或参考视频放进来",
      promptRequired: true,
      // 上限逐项对账两家官方文档（2026-08-12）：kie reference_image_urls/video/audio = 30/10/10；
      // apimart image_urls/video_urls/audio_urls = 30/10/10。曾写 9/3/3 是我们自己填窄的，
      // 用户想连 4 段白膜做分镜时第 4 段就加不进去——能力有、被档案掐了。
      slots: [
        { kind: "image_ref", label: "角色参考", min: 0, max: 30, characterIndexed: true },
        { kind: "video_ref", label: "参考视频", min: 0, max: 10 },
        // **故意不声明 requiresAnyOf**：2.0 的参考音频必须搭配图/视频，2.5 明确解除了
        // （方舟「Seedance 2.5 新增支持纯音频参考生成视频，无需搭配图片或视频素材」；APIMart "audio-only OK"）。
        // 别在"对齐两代"时补回来——seedance20Contract.test.ts 有负向钉子拦着。
        { kind: "audio_ref", label: "参考音频", min: 0, max: 10 },
      ],
      transportTaskKind: "image_to_video",
      params: PARAMS,
    },
  ],
};
