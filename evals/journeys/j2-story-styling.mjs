import { check } from "../lib/journeyRunner.mjs";
import { createBlankProject } from "../lib/isoApp.mjs";

const STORY = "雨夜的旧车站，红围巾女孩小岚找到一只受伤的白色机械鸟。她替它修好翅膀，清晨机械鸟带她飞过云层。";

export default {
  id: "j2-story-styling",
  name: "故事定妆与漫画短片准备",
  needsAgent: true,
  smoke: false,
  successCriterion: "建立角色卡与场景卡，三镜头共享定妆引用并进入可批量生成状态",
  async setup({ win, iso }) {
    return createBlankProject(win, iso.projectsDir);
  },
  milestones: [
    {
      id: "character-anchor",
      title: "建立角色卡与场景卡",
      say: `先为这个漫画故事建立两个定妆锚点：一个 kind=character 的“小岚角色设定”角色卡，提示词必须逐字包含“红围巾”“黑色短发”“黄色雨衣”三个身份短语；一个 kind=scene 的“雨夜旧车站”场景卡，提示词必须逐字包含“雨夜”“旧站台”“冷色灯光”三个场景短语。两张卡都选择可用图片模型并配好参数，但不要执行生成：${STORY}`,
      verify(ctx) {
        const character = ctx.created().find((node) => node.kind === "character" && /小岚|角色/.test(`${node.title || ""}${node.prompt || ""}`));
        const scene = ctx.created().find((node) => node.kind === "scene" && /车站|场景/.test(`${node.title || ""}${node.prompt || ""}`));
        return [
          check("有角色定妆 character 卡", Boolean(character), `character=${character?.id || "missing"}`, "outcome"),
          check("有雨夜旧车站 scene 卡", Boolean(scene), `scene=${scene?.id || "missing"}`, "outcome"),
          check(
            "角色身份特征完整",
            Boolean(character) && ["红围巾", "黑色短发", "黄色雨衣"].every((term) => String(character.prompt || "").includes(term)),
            character ? `prompt=${String(character.prompt || "").slice(0, 240)}` : "character missing",
            "quality",
          ),
          check(
            "场景视觉锚点完整",
            Boolean(scene) && ["雨夜", "旧站台", "冷色灯光"].every((term) => String(scene.prompt || "").includes(term)),
            scene ? `prompt=${String(scene.prompt || "").slice(0, 240)}` : "scene missing",
            "quality",
          ),
          check("两张定妆卡已绑定可用模型", [character, scene].every((node) => node?.meta?.modelKey && node?.meta?.archetype?.id), "", "outcome"),
        ];
      },
    },
    {
      id: "styled-shots",
      title: "创建引用定妆且可批量生成的连续镜头",
      say: "继续创建 3 个 video 漫画镜头：雨夜相遇、修好翅膀、清晨飞过云层。每个镜头提示词必须逐字包含“红围巾”“黑色短发”“黄色雨衣”这三个身份短语；选择支持图片参考的可用视频模型，每个节点都显式提供 modelKey、modeId，以及包含 aspect_ratio 和 duration 的 params。把已有的小岚角色卡连接到全部 3 个镜头，把雨夜旧车站场景卡连接到适用镜头作为参考。不要执行真实生成。",
      async beforeEvidence(ctx) {
        // create_canvas_nodes 会选中最后落下的卡片；真实用户点一次画布空白后，
        // 全画布待生成任务的“全部生成”dock 才按产品规则出现。
        await ctx.win.locator('.generation-canvas-v2__stage').click({ position: { x: 120, y: 120 } });
      },
      async verify(ctx) {
        const created = ctx.created();
        const character = created.find((node) => node.kind === "character");
        const scene = created.find((node) => node.kind === "scene");
        const shots = created.filter((node) => node.kind === "video");
        const edgePairs = new Set(ctx.edges().map((edge) => `${edge.source}->${edge.target}`));
        const characterRefs = shots.filter((shot) => edgePairs.has(`${character?.id}->${shot.id}`));
        const sceneRefs = shots.filter((shot) => edgePairs.has(`${scene?.id}->${shot.id}`));
        const identityMissing = shots.filter((node) => !["红围巾", "黑色短发", "黄色雨衣"].every((term) => String(node.prompt || "").includes(term)));
        const configMissing = shots.filter((node) => !node.meta?.modelKey || !node.meta?.archetype?.id || !node.meta?.aspect_ratio || Number(node.meta?.duration) <= 0);
        return [
          check("创建 3 个漫画镜头", shots.length === 3, `shots=${shots.length}`, "outcome"),
          check("每个镜头有可执行画面提示词", shots.length > 0 && shots.every((node) => String(node.prompt || "").trim().length >= 20), "", "quality"),
          check("每个镜头保留角色身份特征", shots.length === 3 && identityMissing.length === 0, identityMissing.map((node) => node.title || node.id).join(", "), "quality"),
          check("角色卡引用到三个镜头", characterRefs.length === 3, `characterRefs=${characterRefs.length}`, "outcome"),
          check("场景卡至少约束雨夜镜头", sceneRefs.length >= 1, `sceneRefs=${sceneRefs.length}`, "outcome"),
          check("镜头模型、画幅与时长已配齐", shots.length === 3 && configMissing.length === 0, configMissing.map((node) => node.title || node.id).join(", "), "outcome"),
        ];
      },
    },
  ],
};
