/**
 * Depth video node — local model manifest (whitelist).
 *
 * v1 downloads exactly three assets, all pinned to whitelisted URLs and an
 * optional sha256. The small depth model sha256 was measured on 2026-09-06
 * from the exact fp16 artifact this node ships; base/pose entries keep an
 * empty sha256 until the first real download (runtime writes its own computed
 * sha256 into the userData cache manifest after a successful download — a
 * size pre-check + self-bootstrapped hash rather than a hardcoded one).
 *
 * No Electron / React imports — pure shared data (renderer + main both read it).
 */
export type VideoDepthModelRole = "depth" | "pose";

export type VideoDepthModelAsset = {
  id: string;
  role: VideoDepthModelRole;
  /** depth: 'small' | 'base'   pose: 'full' (v1 scope only). */
  kindKey: string;
  fileName: string;
  downloadUrl: string;
  sizeBytesApprox: number;
  sha256?: string;
  note?: string;
};

export const VIDEO_DEPTH_MODEL_MANIFEST: VideoDepthModelAsset[] = [
  {
    id: "depth_small",
    role: "depth",
    kindKey: "small",
    fileName: "depth_anything_v2_small_fp16.onnx",
    downloadUrl:
      "https://hf-mirror.com/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_fp16.onnx",
    sizeBytesApprox: 49_642_442,
    sha256: "2df6223f206b5164e21f664ace61dabeb9bb6a49b8b5a3e00510b4807d0f5b04",
    note: "measured 2026-09-06; dynamic input [B,3,H,W], output floored to /14",
  },
  {
    id: "depth_base",
    role: "depth",
    kindKey: "base",
    fileName: "depth_anything_v2_base_fp16.onnx",
    downloadUrl:
      "https://hf-mirror.com/onnx-community/depth-anything-v2-base/resolve/main/onnx/model_fp16.onnx",
    sizeBytesApprox: 190 * 1024 * 1024,
    note: "size approx; sha256 self-bootstrapped into userData manifest on first download",
  },
  {
    id: "pose_full",
    role: "pose",
    kindKey: "full",
    fileName: "pose_landmarker_full.task",
    downloadUrl:
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
    sizeBytesApprox: 8 * 1024 * 1024,
    note: "MediaPipe PoseLandmarker full tier; v1 only tier (lite/heavy out of scope)",
  },
];

export function videoDepthModelFor(role: VideoDepthModelRole, kindKey: string): VideoDepthModelAsset | undefined {
  return VIDEO_DEPTH_MODEL_MANIFEST.find((m) => m.role === role && m.kindKey === kindKey);
}

/** Assets required for a given mode / depth model choice (pose omitted when mode is depth-only). */
export function videoDepthRequiredAssets(mode: "depth" | "depth_skeleton" | "original_skeleton", depthModel: "small" | "base") {
  const needDepth = mode === "depth" || mode === "depth_skeleton";
  const needPose = mode === "depth_skeleton" || mode === "original_skeleton";
  const assets: VideoDepthModelAsset[] = [];
  if (needDepth) {
    const a = videoDepthModelFor("depth", depthModel);
    if (a) assets.push(a);
  }
  if (needPose) {
    const a = videoDepthModelFor("pose", "full");
    if (a) assets.push(a);
  }
  return assets;
}
