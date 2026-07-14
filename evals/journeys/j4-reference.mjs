import { check } from "../lib/journeyRunner.mjs";
import { createBlankProject } from "../lib/isoApp.mjs";

export default {
  id: "j4-reference",
  name: "参考图驱动生成准备",
  needsAgent: true,
  smoke: false,
  successCriterion: "参考源与目标生成节点结构明确，引用边和目标模型参数可执行",
  async setup({ win, iso }) {
    return createBlankProject(win, iso.projectsDir);
  },
  milestones: [
    {
      id: "reference-graph",
      title: "建立参考源与目标节点",
      say: "在画布创建两个节点：一个 image 节点标题为“产品参考图”，提示词写钛灰色便携咖啡机；一个 video 节点标题为“参考图动画”，提示词写咖啡机在露营桌上缓慢环绕展示。把产品参考图连接到参考图动画作为引用。",
      verify(ctx) {
        const nodes = ctx.created();
        const source = nodes.find((node) => node.kind === "image" && /产品参考图/.test(String(node.title || "")));
        const target = nodes.find((node) => node.kind === "video" && /参考图动画/.test(String(node.title || "")));
        const linked = ctx.edges().some((edge) => edge.source === source?.id && edge.target === target?.id);
        return [
          check("参考源 image 节点存在", Boolean(source), "", "outcome"),
          check("目标 video 节点存在", Boolean(target), "", "outcome"),
          check("引用边从参考源指向目标", linked, `source=${source?.id} target=${target?.id}`, "outcome"),
        ];
      },
    },
    {
      id: "generation-ready",
      title: "把参考图动画配到可生成状态",
      say: "给“参考图动画”选择支持图生视频的可用模型，设置 16:9、5 秒并保留刚才的参考连接，不要执行真实生成。",
      verify(ctx) {
        const target = ctx.created().find((node) => node.kind === "video" && /参考图动画/.test(String(node.title || "")));
        const hasReference = ctx.edges().some((edge) => edge.target === target?.id);
        return [
          check("目标绑定模型与 archetype", Boolean(target?.meta?.modelKey && target?.meta?.archetype?.id), JSON.stringify(target?.meta || {}), "outcome"),
          check("目标设置 16:9 和可执行时长", (target?.meta?.aspect_ratio === "16:9" || target?.meta?.size === "16:9") && Number(target?.meta?.duration) > 0, JSON.stringify(target?.meta || {}), "outcome"),
          check("配置后引用边仍存在", hasReference, "", "outcome"),
        ];
      },
    },
  ],
};
