import { describe, expect, it, vi } from "vitest";

import { createGenerationOutputMaterializer } from "./generationOutputMaterializer";

describe("generation output materializer", () => {
  it("stores a provider output with a content hash and deterministic receipt fields", async () => {
    const writeAsset = vi.fn(() => ({ id: "asset-1", data: { relativePath: "assets/generated/video.mp4" } }));
    const materializer = createGenerationOutputMaterializer({
      fetchOutput: vi.fn(async () => ({ bytes: Buffer.from("video-bytes"), contentType: "video/mp4", status: 200, finalUrl: "https://cdn.example/video.mp4", truncated: false })),
      writeAsset,
    });

    await expect(materializer.materialize({
      projectId: "project-1",
      providerTaskId: "task-1",
      output: { kind: "video", url: "https://cdn.example/video.mp4" },
    })).resolves.toMatchObject({ artifactId: "asset-1", kind: "video", projectRelativePath: "assets/generated/video.mp4", contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(writeAsset).toHaveBeenCalledWith("project-1", Buffer.from("video-bytes"), "video.mp4", "video/mp4", expect.objectContaining({ kind: "generated", providerTaskId: "task-1" }), "task-1:https://cdn.example/video.mp4");
  });

  it("accepts bounded data URLs without network access and rejects mismatched media types", async () => {
    const fetchOutput = vi.fn();
    const writeAsset = vi.fn(() => ({ id: "asset-image", data: { relativePath: "assets/generated/image.png" } }));
    const materializer = createGenerationOutputMaterializer({ fetchOutput, writeAsset });
    await expect(materializer.materialize({ projectId: "project-1", providerTaskId: "task-2", output: { kind: "image", url: "data:image/png;base64,aW1hZ2U=" } })).resolves.toMatchObject({ artifactId: "asset-image", kind: "image" });
    expect(fetchOutput).not.toHaveBeenCalled();
    await expect(materializer.materialize({ projectId: "project-1", providerTaskId: "task-3", output: { kind: "video", url: "data:image/png;base64,aW1hZ2U=" } })).rejects.toThrow(/does not match video/);
  });

  it("downloads model3d as GLB and forwards it to the shared validated asset store", async () => {
    const bytes = Buffer.from("glTF-placeholder");
    const fetchOutput = vi.fn(async () => ({ bytes, contentType: "model/gltf-binary", status: 200, finalUrl: "https://cdn.example/model.glb", truncated: false }));
    const writeAsset = vi.fn(() => ({ id: "asset-3d", data: { relativePath: "assets/generated/model.glb", contentType: "model/gltf-binary" } }));
    const materializer = createGenerationOutputMaterializer({ fetchOutput, writeAsset });

    await expect(materializer.materialize({
      projectId: "project-1",
      providerTaskId: "task-3d",
      output: { kind: "model3d", url: "https://cdn.example/model.glb" },
    })).resolves.toMatchObject({ artifactId: "asset-3d", kind: "model3d", projectRelativePath: "assets/generated/model.glb" });
    expect(fetchOutput).toHaveBeenCalledWith("https://cdn.example/model.glb", expect.objectContaining({
      allowContentTypes: expect.arrayContaining(["model/gltf-binary", "application/octet-stream"]),
    }));
    expect(writeAsset).toHaveBeenCalledWith(
      "project-1",
      bytes,
      "model.glb",
      "model/gltf-binary",
      expect.objectContaining({ kind: "generated", providerTaskId: "task-3d" }),
      expect.any(String),
    );
  });
});
