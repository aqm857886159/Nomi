/**
 * Deterministic, in-memory media used by the ComfyUI certification run.
 *
 * These are deliberately data URLs: the normal asset-localization path can
 * decode and upload them to the user's ComfyUI instance, while no temporary
 * source file or user project is needed. Each image slot receives a different
 * visible color so a fixture cannot accidentally prove that every slot was
 * wired to the same input.
 */

export type ComfyCertificationMediaSlot = {
  paramKey: string;
  label: string;
  mediaKind: "image" | "video";
};

const IMAGE_FIXTURES = [
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP47+DwHwAGQAJ/VqQvJQAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwWPD/PwAF4gLfHLMKeAAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMIOFHxHwAFjAKQMBBt4gAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4usXmPwAHbALlRWRJVwAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPYl/LsPwAG9AMI3uML8AAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQO7HvPwAFUAKkzVtmHwAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4kLLlPwAHWAMIIQQhtgAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNomhbwHwAFbgJot4p9WAAAAABJRU5ErkJggg==",
] as const;

const VIDEO_FIXTURE =
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAN1bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAMgAAQAAAQAAAAAAAAAAAAAAAAEAAAAA" +
  "AAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAp90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAAB" +
  "AAAAAAAAAMgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAA" +
  "AAEAAADIAAAEAAABAAAAAAIXbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAACgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRl" +
  "b0hhbmRsZXIAAAABwm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAYJzdGJsAAAAvnN0c2QA" +
  "AAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "GP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAHTgAAB0" +
  "4AAAABhzdHRzAAAAAAAAAAEAAAAFAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAOGN0dHMAAAAAAAAABQAAAAEAAAQAAAAAAQAACgAAAAABAAAEAAAAAAEA" +
  "AAAAAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAUAAAABAAAAKHN0c3oAAAAAAAAAAAAAAAUAAAK8AAAADAAAAAwAAAAMAAAADAAAABRzdGNvAAAA" +
  "AAAAAAEAAAOlAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAAB" +
  "AAAAAExhdmY1OC43Ni4xMDAAAAAIZnJlZQAAAvRtZGF0AAACoAYF//+c3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2MSAtIEguMjY0L01QRUctNCBB" +
  "VkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjAgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0z" +
  "IGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5n" +
  "ZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIg" +
  "dGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9" +
  "MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29w" +
  "PTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0yNSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBt" +
  "YnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAABRliIQAM//+" +
  "3zL4FNaFDnRCM2R0vwAAAAhBmiRsQr/+wAAAAAhBnkJ4hf/BgQAAAAgBnmF0Qr/EgAAAAAgBnmNqQr/EgQ==";


function dataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64.replace(/\s+/g, "")}`;
}

/** Build explicit per-slot params and the Comfy reference declaration. */
export function buildComfyCertificationFixtureParams(input: {
  vendorKey: string;
  modelKey: string;
  slots: readonly ComfyCertificationMediaSlot[];
}): Record<string, unknown> {
  if (input.slots.length > IMAGE_FIXTURES.length) {
    throw new Error(`comfy_certification_fixture_capacity:${IMAGE_FIXTURES.length}`);
  }
  const params: Record<string, unknown> = {};
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  for (const [index, slot] of input.slots.entries()) {
    const value = slot.mediaKind === "video"
      ? dataUrl("video/mp4", VIDEO_FIXTURE)
      : dataUrl("image/png", IMAGE_FIXTURES[index]);
    params[slot.paramKey] = value;
    if (slot.mediaKind === "video") videoUrls.push(value);
    else imageUrls.push(value);
  }
  return {
    ...params,
    // The contract reader derives identity from the request metadata fields,
    // while the declaration carries the same identity for exact matching.
    // Keep both sides explicit so a candidate vendor cannot silently fall back
    // to legacy aggregate reference handling.
    modelKey: input.modelKey,
    modelVendor: input.vendorKey,
    ...(imageUrls.length ? { referenceImages: imageUrls } : {}),
    ...(videoUrls.length ? { referenceVideoUrls: videoUrls } : {}),
    parameterReferenceSlots: {
      modelKey: input.modelKey,
      vendorKey: input.vendorKey,
      slots: input.slots.map((slot) => ({
        key: slot.paramKey,
        label: slot.label,
        mediaKind: slot.mediaKind,
        group: "reference" as const,
      })),
    },
  };
}
