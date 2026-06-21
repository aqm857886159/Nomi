// 合成用户人格 × 场景数据集 —— 自我改进 loop 的「验证器输入」,也是护城河。
// 目标(用户拍板):尽量覆盖每一类用户,让每类都能在 Nomi 里很好地用起来。
// 每条场景 = 一个真实创作意图 + 它会动用的能力族(archetype family) + 成功标准。
// archetype family 对齐 Nomi 现有能力轴(见 src/config/modelArchetypes/)。
// S1:被 mock target 消费,离线出指标。S2:换成真 capability-core 驱动。

/** Nomi 当前真实具备的能力族(用于覆盖打分;诚实标缺口,D4)。
 *  注:lipsync(唇形同步)Nomi 暂无 → 教育/对口型类会露馅,正是要量化出来的。 */
export const NOMI_CAPABILITIES = new Set([
  "t2i", // 文生图
  "i2v", // 图生视频
  "t2v", // 文生视频
  "character_ref", // 角色参考(定妆/角色卡一致性)
  "style_ref", // 风格参考
  "first_last_frame", // 首尾帧控制
  "image_ref", // 通用参考图
  "tts", // 配音
  "transcription", // 转写
  "timeline", // 时间轴排片/导出
  // ⚠️ 暂无:lipsync(唇形)、music_gen(配乐生成)、beat_sync(卡点对齐)
]);

/**
 * @typedef {{ id:string, intent:string, aspect:string, expects:string[], success:string }} Scenario
 * @typedef {{ id:string, label:string, who:string, friction:string, scenarios:Scenario[] }} Persona
 * @type {Persona[]}
 */
export const PERSONAS = [
  {
    id: "novice-oneshot",
    label: "新手 · 一句话出片",
    who: "没经验,想一句话生成,全程要 AI 托管",
    friction: "不懂镜头/参数,任何要学要配的都劝退",
    scenarios: [
      {
        id: "birthday-10s",
        intent: "给我做个 10 秒生日祝福视频,温馨一点",
        aspect: "16:9",
        expects: ["t2i", "i2v", "timeline"],
        success: "无需配置,直接出一条可播放的成片",
      },
    ],
  },
  {
    id: "shortform-creator",
    label: "短视频创作者 · 竖屏钩子",
    who: "抖音/TikTok,要快、要钩子、竖屏",
    friction: "前 3 秒不抓人就废;要竖屏 9:16",
    scenarios: [
      {
        id: "product-hook-15s",
        intent: "15 秒竖屏:开头 1 秒强钩子,种草一款保温杯",
        aspect: "9:16",
        expects: ["t2i", "i2v", "timeline"],
        success: "竖屏成片 + 前 3 秒有视觉钩子",
      },
    ],
  },
  {
    id: "narrative-storyteller",
    label: "叙事创作者 · 多镜头角色一致",
    who: "拍剧情小故事,同一角色要跨镜头一致",
    friction: "多张参考图模型分不清谁是谁 → 张冠李戴",
    scenarios: [
      {
        id: "3shot-samechar",
        intent: "3 个镜头的小故事,同一个女孩贯穿全程",
        aspect: "16:9",
        expects: ["t2i", "character_ref", "i2v", "timeline"],
        success: "三镜头里角色脸/装一致,镜序正确",
      },
    ],
  },
  {
    id: "brand-marketer",
    label: "品牌营销 · 产品/logo 横屏",
    who: "品牌方,要调性统一、产品/logo 出镜",
    friction: "品牌调性飘、产品形态被模型改样",
    scenarios: [
      {
        id: "brand-promo",
        intent: "品牌宣传片,产品多角度展示,统一冷色调",
        aspect: "16:9",
        expects: ["t2i", "image_ref", "i2v", "timeline"],
        success: "产品形态稳、色调统一、可导出",
      },
    ],
  },
  {
    id: "anime-stylist",
    label: "二次元 · 画风一致",
    who: "动漫/插画风短片,画风必须锁死",
    friction: "换镜头画风就漂",
    scenarios: [
      {
        id: "anime-short",
        intent: "赛璐璐画风的 2 镜头短片,统一画风",
        aspect: "16:9",
        expects: ["t2i", "style_ref", "i2v", "timeline"],
        success: "两镜头画风一致",
      },
    ],
  },
  {
    id: "power-user",
    label: "专业精修 · 参考图+首尾帧+参数",
    who: "会自己调参,用参考图锁角色、首尾帧控运动",
    friction: "要细控,托管式反而碍事",
    scenarios: [
      {
        id: "ref-firstlast",
        intent: "用我的参考图锁角色,首帧站立尾帧奔跑,精控运动",
        aspect: "16:9",
        expects: ["image_ref", "character_ref", "first_last_frame", "i2v"],
        success: "参考图喂到、首尾帧生效、参数可改",
      },
    ],
  },
  {
    id: "educator-explainer",
    label: "教育解说 · 配音+转写",
    who: "做科普/解说,要画面配旁白",
    friction: "口播对口型 Nomi 暂无 → 须诚实跳过",
    scenarios: [
      {
        id: "sci-explainer",
        intent: "科普短片:画面 + 一段中文旁白配音",
        aspect: "16:9",
        expects: ["t2i", "i2v", "tts", "transcription", "timeline"],
        success: "画面+配音对齐;⚠️ 口型同步缺口须明示",
      },
    ],
  },
  {
    id: "music-mv",
    label: "音乐 MV · 卡点节奏",
    who: "给音乐片段配画面,要卡节拍",
    friction: "卡点/配乐生成 Nomi 暂无 → 露缺口",
    scenarios: [
      {
        id: "music-clip",
        intent: "给这段音乐配一个有节奏感的画面 MV",
        aspect: "16:9",
        expects: ["t2i", "i2v", "beat_sync", "music_gen", "timeline"],
        success: "画面随节拍切;⚠️ 卡点/配乐缺口须明示",
      },
    ],
  },
];

/** 摊平成 runEvals 风格的数据项(每个场景一行,带它属于哪个人格)。 */
export const SCENARIO_ITEMS = PERSONAS.flatMap((p) =>
  p.scenarios.map((s) => ({ personaId: p.id, personaLabel: p.label, ...s })),
);
