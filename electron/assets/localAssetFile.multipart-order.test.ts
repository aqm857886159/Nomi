import { beforeEach, describe, expect, it, vi } from "vitest";

const appFetch = vi.fn();
vi.mock("../appFetch", () => ({ appFetch }));

const { postMultipartForAssetUpload } = await import("./localAssetFile");

describe("postMultipartForAssetUpload", () => {
  beforeEach(() => appFetch.mockReset());

  it("puts signed form fields before the file part", async () => {
    let body: FormData | null = null;
    appFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (!init) return new Response(null, { status: 200 });
      body = init.body as FormData;
      return new Response(null, { status: 204 });
    });

    await postMultipartForAssetUpload(
      "https://signed.example/upload",
      {},
      Buffer.from("png-bytes"),
      "frame.png",
      "image/png",
      { key: "uploads/frame.png", Policy: "signed-policy" },
    );

    expect(body).not.toBeNull();
    expect(Array.from(body!.keys())).toEqual(["key", "Policy", "file"]);
  });
});
