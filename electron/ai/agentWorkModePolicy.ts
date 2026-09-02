import type { ProjectAgentWorkMode } from "../shared/projectAgentContracts";

/** Stable, short instructions appended to the model-facing system prompt. */
export function workModeInstruction(mode: ProjectAgentWorkMode | undefined): string {
  switch (mode) {
    case "ask":
      return "工作模式：Ask。只做解释、比较和建议，先给出计划；不要写入文稿、画布、时间线或提交生成，只有用户切到可写模式并通过 Host 确认后才行动。";
    case "editSelection":
      return "工作模式：编辑选中。只对用户当前冻结的选中范围提出修改，不要触碰选区之外的对象、也不要跨对象规划新任务；改动仍需按批准策略经 Host 确认。";
    case "agent":
    default:
      return "工作模式：Agent。先读取现场并给出简短计划；获批后可跨对象连续推进可撤销的多步任务，但付费、删除、导出、发布和状态未知的操作仍需 Host 确认。";
  }
}
