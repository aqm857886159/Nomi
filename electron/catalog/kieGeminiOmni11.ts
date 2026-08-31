import type { HttpOperation, ProfileKind } from "./types";

export const GEMINI_OMNI_11_MODEL_SEED = {
  modelKey: "google/gemini-omni-flash-1-1",
  labelZh: "Gemini Omni 1.1 Flash",
  kind: "video" as const,
};

export const GEMINI_OMNI_11_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/api/v1/jobs/createTask",
  headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
  body: {
    model: "google/gemini-omni-flash-1-1",
    input: {
      prompt: "{{request.prompt}}",
      image_urls: "{{request.params.image_urls}}",
      // KIE publishes these as first-class multimodal fields. The renderer
      // currently has no typed character/audio-id picker, so headless callers
      // may supply arrays directly; the capability ledger keeps those fields
      // documented while UI coverage remains an explicit blocker.
      audio_ids: "{{request.params.audio_ids}}",
      video_list: "{{request.params.video_list}}",
      character_ids: "{{request.params.character_ids}}",
      first_frame_url: "{{request.params.first_frame_url}}",
      last_frame_url: "{{request.params.last_frame_url}}",
      duration: "{{request.params.duration}}",
      aspect_ratio: "{{request.params.aspect_ratio}}",
      resolution: "{{request.params.resolution}}",
      seed: "{{request.params.seed}}",
    },
  },
  response_mapping: { task_id: "data.taskId" },
  provider_meta_mapping: { task_id: "data.taskId" },
  // KIE's documented enum is numeric-looking but the API validator requires a JSON string
  // (live response: `duration it must be a string`). Keep the UI's numeric option and
  // stringify only at this mapping boundary; other vendors retain their native numeric wire type.
  paramMap: { rules: [{ wire: "duration", fromMany: ["duration"], transform: "toString" }] },
};

const GEMINI_OMNI_11_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/api/v1/jobs/recordInfo",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  query: { taskId: "{{providerMeta.task_id}}" },
  response_mapping: {
    task_id: "data.taskId",
    status: "data.state",
    video_url: "data.resultJson.resultUrls[*]",
    error_message: "data.failMsg",
  },
};

const mapping = (taskKind: ProfileKind, name: string) => ({
  taskKind,
  modelKey: GEMINI_OMNI_11_MODEL_SEED.modelKey,
  name,
  create: GEMINI_OMNI_11_CREATE_OP,
  query: GEMINI_OMNI_11_QUERY_OP,
});

export const GEMINI_OMNI_11_MAPPINGS = [
  { id: "seed-kie-gemini-omni-1-1-text_to_video", ...mapping("text_to_video", "Gemini Omni 1.1 · 文生视频") },
  { id: "seed-kie-gemini-omni-1-1-image_to_video", ...mapping("image_to_video", "Gemini Omni 1.1 · 参考生视频") },
];
