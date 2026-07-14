import { check } from "../lib/journeyRunner.mjs";
import { createBlankProject } from "../lib/isoApp.mjs";

const STORY = "雨夜的旧车站，红围巾女孩小岚找到一只受伤的白色机械鸟。她替它修好翅膀，清晨机械鸟带她飞过云层。";

export default {
  id: "j2-story-styling",
  name: "故事定妆与漫画短片准备",
  needsAgent: true,
  smoke: false,
  successCriterion: "建立角色定妆锚点与连续镜头，角色提示词和引用关系可追踪",
  async setup({ win, iso }) {
    return createBlankProject(win, iso.projectsDir);
  },
  milestones: [
    {
      id: "character-anchor",
      title: "建立角色定妆锚点",
      say: `为故事主角先创建一个 image 类型的角色定妆节点，标题包含“小岚角色设定”，提示词必须明确红围巾、黑色短发、黄色雨衣三个身份特征：${STORY}`,
      verify(ctx) {
        const anchors = ctx.created().filter((node) => node.kind === "image" && /小岚|角色/.test(`${node.title || ""}${node.prompt || ""}`));
        return [
          check("有角色定妆 image 节点", anchors.length >= 1, `anchors=${anchors.length}`, "outcome"),
          check("角色身份特征完整", anchors.some((node) => ["红围巾", "黑色短发", "黄色雨衣"].every((term) => String(node.prompt || "").includes(term))), "", "quality"),
        ];
      },
    },
    {
      id: "styled-shots",
      title: "创建引用定妆的连续镜头",
      say: "继续创建 3 个 image 类型漫画镜头：雨夜相遇、修好翅膀、清晨飞过云层。每个镜头提示词都保留小岚的三个身份特征，并从角色设定节点向每个镜头连接引用边。",
      verify(ctx) {
        const created = ctx.created();
        const outgoing = new Map();
        for (const edge of ctx.edges()) outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
        const anchor = created.find((node) => (outgoing.get(node.id)?.length || 0) >= 3);
        const referenced = new Set(outgoing.get(anchor?.id) || []);
        const shots = created.filter((node) => referenced.has(node.id) && node.kind === "image");
        return [
          check("创建 3 个漫画镜头", shots.length === 3, `shots=${shots.length}`, "outcome"),
          check("每个镜头有可执行画面提示词", shots.length > 0 && shots.every((node) => String(node.prompt || "").trim().length >= 20), "", "quality"),
          check("定妆锚点引用到每个镜头", shots.every((node) => referenced.has(node.id)), `referenced=${referenced.size}`, "outcome"),
        ];
      },
    },
  ],
};
