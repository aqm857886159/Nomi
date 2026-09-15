// Agent lane · `document.read` / `document.write` 的**执行那一半**。
//
// 说明书那一半是 `electron/shared/agentCapabilities/verbs/readVerbs.ts` / `writeVerbs.ts` 里的动词声明
// （`read_script` / `write_script`）；动词参数 → 契约语义输入的翻译住在声明上（`verbs/verbSemanticInput.ts`），
// 这里只执行，再交给活着的领域 port。
import { projectDocumentRead, type DocumentReadInput, type DocumentReadResult } from "../shared/agentCapabilities/documentRead";
import { documentWriteResultSchema, type DocumentWriteInput, type DocumentWriteResult } from "../shared/agentCapabilities/documentWrite";
import { specsForCapability } from "../shared/agentCapabilities/modelFacingToolRegistry";
import { bindLaneTool, type LaneToolDescriptor, type LaneToolExecutionContext } from "./laneRuntimePort";
import { toSemanticInput } from "../shared/agentCapabilities/modelFacingTools";

/** 领域侧。lane 不认识编辑器，只认识这两个动作——K4/K5 的「按 id 引用，永不复制」同一条纪律。 */
export interface DocumentLanePort {
  read(scope: DocumentReadInput["scope"], context: LaneToolExecutionContext): Promise<unknown>;
  write(input: DocumentWriteInput, context: LaneToolExecutionContext): Promise<DocumentWriteResult>;
}


export function createDocumentLaneTools(port: DocumentLanePort): LaneToolDescriptor[] {
  return [...specsForCapability("document.read"), ...specsForCapability("document.write")].map((spec) => {
    if (spec.contractId === "document.read") {
      return bindLaneTool(spec, async (args, context) => {
        const scope = ((args as { scope?: DocumentReadInput["scope"] }).scope ?? "full");
        const result: DocumentReadResult = projectDocumentRead(await port.read(scope, context));
        return { ok: true, text: result.text, details: { scope } };
      });
    }
    return bindLaneTool(spec, async (args, context) => {
      // 形状由 pi 的 ajv 验过、契约 parse 由 `laneTools.mts` 在唯一出口跑过，才轮到这里；这里不再 parse。
      const input = toSemanticInput(spec, args as Record<string, unknown>) as DocumentWriteInput;
      const receipt = documentWriteResultSchema.parse(await port.write(input, context));
      return {
        ok: true,
        text: `Applied ${input.operation} to the document. New revision ${receipt.revision}.`,
        details: receipt,
        nextAction: { kind: "none", userSees: `The document now contains the new text (${input.operation}); the user can undo it with Cmd+Z.` },
      };
    });
  });
}
