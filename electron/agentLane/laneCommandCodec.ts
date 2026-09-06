// Agent lane · 过桥命令的解码（纯函数，不认识 electron）
//
// **渲染层不再铸造宿主记录。** 今天它在 `projectAgentTurnCommands.ts:88-167` 里造 thread /
// turn / item / executionToken / contextRef 送过桥——身份生成在桥的**不可信一侧**
// （#546 V10）。新通路上渲染层只能说两句话：「跑这段提示词」和「停」。
// 身份（operationId / entryId / sessionId）全部由主进程和 pi 铸造。
//
// 拆成独立文件是为了能不起 electron 就测它：`laneIpc.ts` 顶部 `import { ipcMain } from
// "electron"`，那一行会让 node --test 直接炸。判据和绑定分开，判据就能被真正测到。
import type { LaneCommand } from "../shared/agentLane/laneContracts";

export class LaneCommandError extends Error {
  readonly code = "agent_lane_invalid_command" as const;
}

/** 提示词的字节上限。桥上任何一条没有上限的字符串都是一次免费的内存放大器。 */
const MAX_PROMPT_BYTES = 128 * 1024;

/**
 * 把线上的任意值解成一条命令，或者**抛**。
 * 不做「猜一个默认值」这种事：一条解不出来的命令继续往下走，最后会变成一次没人预期的模型调用。
 */
export function parseLaneCommand(wire: unknown): LaneCommand {
  if (!wire || typeof wire !== "object" || Array.isArray(wire)) {
    throw new LaneCommandError("Lane command must be an object");
  }
  const record = wire as Record<string, unknown>;
  if (record.kind === "abort") return { kind: "abort" };
  if (record.kind !== "prompt") {
    throw new LaneCommandError(`Unknown lane command kind: ${String(record.kind)}`);
  }
  const text = record.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new LaneCommandError("A prompt command needs non-empty text");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_PROMPT_BYTES) {
    throw new LaneCommandError(`A prompt command must stay under ${MAX_PROMPT_BYTES} bytes`);
  }
  return { kind: "prompt", text };
}
