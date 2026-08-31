import type { ProjectAgentWorkMode } from "../shared/projectAgentContracts";

/** Stable, short instructions appended to the model-facing system prompt. */
export function workModeInstruction(mode: ProjectAgentWorkMode | undefined): string {
  switch (mode) {
    case "ask":
      return "工作模式：问答。先回答和比较，先给出计划；不要擅自写入文稿、画布、时间线或提交生成，只有用户明确要求并通过 Host 确认后才行动。";
    case "guided":
      return "工作模式：引导。把复杂目标拆成可检查阶段，在每个关键阶段说明下一步并等待 Host 的确认；不要跳过高风险边界。";
    case "auto":
      return "工作模式：策略自动。按项目策略推进已确认的可撤销步骤；付费、删除、导出、发布和状态未知的操作始终停下并交给 Host 确认。";
    case "balanced":
    default:
      return "工作模式：平衡。先读取现场并给出简短计划；获批后可连续推进可撤销步骤，但付费、删除、导出、发布和状态未知的操作仍需 Host 确认。";
  }
}
