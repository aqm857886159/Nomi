import { decryptApiKeyRecord, decryptCustomConfigWithLegacy } from "../catalog/secrets";
import { readCatalog } from "../catalog/catalogStore";
import { saveCustomCallMedia } from "../catalog/customCallDispatch";
import { runCustomCallScript } from "../catalog/customCallRunner";
import { vendorForReceipt } from "../productionRun/paidSubmissionReceipt";
import { localizeTaskAssets } from "../assets/localizeTaskAsset";
import { trim } from "../jsonUtils";
import type { PaidSubmissionReceipt } from "../productionRun/paidSubmissionReceipt";
import { buildProfileTaskResult, type TaskRequest, type TaskResult } from "../runtime";
import { recipeFingerprint, rememberTaskResult } from "../vendor/fingerprintCache";
import { buildNormalizedRecipe } from "../vendor/provenance";
import { executeTaskQuery } from "./taskResultQuery";
import { expectedMediaKind, readTaskResponse } from "./taskResultReading";
import { RETRIEVAL_UNAVAILABLE_MESSAGE } from "../shared/nomiErrorCodes";
import { profileAcceptanceIdentity } from "./responseParsing";

export async function recoverAcceptedTask(receipt: PaidSubmissionReceipt, request: TaskRequest): Promise<TaskResult> {
  const { model, mapping, rawAcceptance: response, taskId } = receipt;
  const projectId = trim(request.extras?.projectId),
    nodeId = trim(request.extras?.nodeId);
  const wantedKind = model.kind;
  const vendor = vendorForReceipt(receipt);
  const type = wantedKind === "text" ? "image" : wantedKind;
  if (receipt.source === "audio" && receipt.audio && typeof response === "string") {
    const { decodeAudioBody } = await import("../audio/synchronousAudioResponse");
    const { decodeDoubaoNdjsonAudio } = await import("../catalog/doubaoTtsCodec");
    const { saveGeneratedAudio } = await import("../audioTaskRunner");
    const bytes = Buffer.from(response, "base64");
    const { contentType, codec, format } = receipt.audio;
    const audio =
      codec === "ndjson-base64"
        ? { bytes: decodeDoubaoNdjsonAudio(bytes.toString("utf8")), extension: format, contentType }
        : decodeAudioBody(bytes, contentType, { audioResponse: codec }, { response_format: format }, {});
    const saved = await saveGeneratedAudio(
      { projectId, nodeId },
      audio.bytes,
      `tts-${taskId}.${audio.extension}`,
      audio.contentType,
    );
    if (!saved.data?.url) throw new Error(RETRIEVAL_UNAVAILABLE_MESSAGE);
    return {
      id: taskId,
      kind: request.kind,
      status: "succeeded",
      assets: [{ type: "audio", url: saved.data.url }],
      raw: { audio_url: saved.data.url },
    };
  }
  if (receipt.source === "profile" && mapping) {
    const fingerprint = recipeFingerprint(
      buildNormalizedRecipe({ vendor, model, mappingId: trim((mapping as { id?: unknown }).id), request }),
    );
    const normalized = await buildProfileTaskResult({
      response,
      mapping,
      operation: mapping.create,
      request,
      taskIdFallback: taskId,
      wantedKind,
      projectId,
      nodeId,
      model,
      vendor,
    });
    if (!receipt.remoteTaskId && !normalized.result.assets.length && normalized.result.status !== "failed")
      throw new Error(RETRIEVAL_UNAVAILABLE_MESSAGE);
    if (
      !receipt.remoteTaskId ||
      !mapping.query ||
      normalized.result.assets.length ||
      normalized.result.status === "failed"
    ) {
      rememberTaskResult(projectId, fingerprint, normalized.result);
      return normalized.result;
    }
  }
  let urls: string[];
  if (receipt.source === "assets") urls = response as string[];
  else if (receipt.source === "profile" && !mapping)
    urls = readTaskResponse({
      response,
      responseMapping: null,
      statusMapping: undefined,
      wantedKind: expectedMediaKind(wantedKind),
    }).assetUrls;
  else {
    const catalog = readCatalog();
    const live = catalog.vendors.find((item) => item.key === receipt.vendorKey && item.enabled);
    if (!live && receipt.authType !== "none") throw new Error(RETRIEVAL_UNAVAILABLE_MESSAGE);
    const connection = vendorForReceipt(receipt, live);
    const key = catalog.apiKeysByVendor[receipt.vendorKey];
    const apiKey = receipt.authType === "none" ? "" : decryptApiKeyRecord(key);
    if (receipt.authType !== "none" && !apiKey) throw new Error(RETRIEVAL_UNAVAILABLE_MESSAGE);
    if (mapping?.query && receipt.remoteTaskId) {
      const providerMeta = profileAcceptanceIdentity(response, mapping.create, taskId).providerMeta;
      const fingerprint = recipeFingerprint(
        buildNormalizedRecipe({ vendor: connection, model, mappingId: trim((mapping as { id?: unknown }).id), request }),
      );
      return (
        await executeTaskQuery(
          taskId,
          {
            vendor: receipt.vendorKey,
            request,
            raw: response,
            mapping,
            model,
            providerMeta,
            projectId,
            nodeId,
            fingerprint,
            wantedKind,
          },
          undefined,
          { vendor: connection, model, apiKey },
        )
      ).result;
    }
    if (!receipt.scriptCall) throw new Error(RETRIEVAL_UNAVAILABLE_MESSAGE);
    const call = receipt.scriptCall;
    const sameOrigin = live && new URL(live.baseUrlHint || "").origin === new URL(receipt.baseUrl).origin;
    const executed = await runCustomCallScript({
      vendor: connection,
      model,
      apiKey,
      customConfig: sameOrigin ? decryptCustomConfigWithLegacy(key, live.meta) : {},
      script: call.script,
      prompt: trim(request.prompt),
      params: call.params,
      saveFile: (bytes, ext, contentType) =>
        saveCustomCallMedia({ projectId, nodeId, model, vendor, taskId, type }, bytes, ext, contentType),
      taskKind: call.taskKind,
      modeId: call.modeId,
      replayCreate: { requestHash: receipt.scriptCall.requestHash, response },
    });
    urls = executed.assets;
  }
  if (!urls.length) throw new Error(RETRIEVAL_UNAVAILABLE_MESSAGE);
  const assets = await localizeTaskAssets(projectId, urls, type, nodeId, vendor);
  return { id: taskId, kind: request.kind, status: "succeeded", assets, raw: response };
}
