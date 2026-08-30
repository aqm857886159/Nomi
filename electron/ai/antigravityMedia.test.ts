import { afterEach, describe, expect, it } from "vitest";
import { exec } from "node:child_process";
import { chmod, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareAntigravityImageInput, prepareAntigravityMedia, verifyAntigravityHook, stageAntigravityMedia } from "./antigravityMedia";
import { imageDecoderInputArgs, readAntigravityFile, validateAntigravityImage } from "./antigravityArtifacts";

const dirs: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5foAAAAASUVORK5CYII=", "base64");
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function fixture(capability: "image" | "edit" | "vision" = "image") {
  const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "nomi-agy-policy-"))); dirs.push(cwd);
  const images = capability === "image" ? [] : [await prepareAntigravityImageInput({ bytes: png, mimeType: "image/png" })];
  const context = await prepareAntigravityMedia(cwd, capability, images);
  const hook = async (kind: "init" | "tool", event: unknown) => {
    // Shell command remains app-owned; stdin carries untrusted tool arguments.
    const hooks = JSON.parse(await readFile(path.join(context.plugin, "hooks.json"), "utf8"))["nomi-task-gate"];
    const command = kind === "init" ? hooks.PreInvocation[0].command : hooks.PreToolUse[0].hooks[0].command;
    const child = exec(command, { timeout: 5_000, windowsHide: true });
    const completion = new Promise<string>((resolve, reject) => {
      let out = "";
      let err = "";
      child.stdout?.on("data", (chunk: string) => { out += chunk; });
      child.stderr?.on("data", (chunk: string) => { err += chunk; });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve(out) : reject(new Error(`hook failed (${code}): ${out} ${err}`)));
    });
    child.stdin?.end(JSON.stringify(event));
    return JSON.parse(await completion) as { decision?: string };
  };
  const args = capability === "vision" ? { AbsolutePath: context.policy.images[0].path } : {
    ImageName: context.policy.imageName, ImagePaths: context.policy.images.map((image) => image.path), Prompt: "A scene",
  };
  return { cwd, context, hook, call: { toolCall: { name: context.tools[0], args } } };
}

describe("Antigravity trusted private plugin", () => {
  it("accepts the optional numeric image aspect ratio emitted by official CLI 1.1.21", async () => {
    const f = await fixture(); await f.hook("init", {}); await stageAntigravityMedia(f.context);
    expect(await f.hook("tool", {toolCall:{...f.call.toolCall,args:{...f.call.toolCall.args,AspectRatio:"1:1"}}})).toEqual({decision:"allow"});
  });
  it("snapshots trusted input bytes before asynchronous staging", async () => {
    const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "nomi-agy-snapshot-"))); dirs.push(cwd);
    const mutable = Buffer.from(png);
    const prepared = await prepareAntigravityImageInput({bytes:mutable,mimeType:"image/png"});
    mutable.fill(0);
    const context = await prepareAntigravityMedia(cwd, "vision", [prepared]);
    expect(context.snapshots[0].bytes).toEqual(png);
    await expect(readFile(context.policy.images[0].path)).rejects.toMatchObject({code:"ENOENT"});
  });
  it("requires the actual initialization hook before any tool authorization", async () => {
    const f = await fixture();
    expect(await f.hook("tool", f.call)).toEqual({ decision: "deny", reason: "Nomi task scope denied" });
    await expect(verifyAntigravityHook(f.context)).rejects.toThrow("HOOK_UNVERIFIED");
    await f.hook("init", {}); await stageAntigravityMedia(f.context); await expect(verifyAntigravityHook(f.context)).resolves.toBeUndefined();
    expect(await f.hook("tool", f.call)).toEqual({decision:"allow"});
  });
  it("atomically authorizes only one generator even when invocations race", async () => {
    const f = await fixture(); await f.hook("init", {}); await stageAntigravityMedia(f.context);
    const results = await Promise.all([f.hook("tool", f.call), f.hook("tool", f.call)]);
    expect(results.filter((value) => value.decision === "deny")).toHaveLength(1);
    expect(results.filter((value) => value.decision === "allow")).toHaveLength(1);
  });
  it.each(["name", "traversal", "reference", "extra"])("denies generator scope escape: %s", async (mode) => {
    const f = await fixture("edit"); await f.hook("init", {}); await stageAntigravityMedia(f.context);
    const args = { ...f.call.toolCall.args } as Record<string, unknown>;
    if (mode === "traversal") args.ImageName = "../../outside";
    if (mode === "reference") args.ImagePaths = ["/private/unrelated.png"];
    if (mode === "extra") args.command = "touch /tmp/not-allowed";
    expect((await f.hook("tool", {toolCall: {name: mode === "name" ? "run_command" : "generate_image", args}})).decision).toBe("deny");
  });
  it("denies changed staged bytes at the tool boundary", async () => {
    const f = await fixture("vision"); await f.hook("init", {}); await stageAntigravityMedia(f.context);
    // chmod is only the fixture acting as the same OS user; tool has no write capability.
    await chmod(f.context.policy.images[0].path, 0o600);
    await writeFile(f.context.policy.images[0].path, Buffer.from("changed"));
    expect((await f.hook("tool", f.call)).decision).toBe("deny");
  });
  it("does not allow the visual tool to inspect other local files", async () => {
    const f = await fixture("vision"); await f.hook("init", {}); await stageAntigravityMedia(f.context);
    expect((await f.hook("tool", {toolCall:{name:"view_file",args:{AbsolutePath:path.join(f.cwd,"task-gate","gate.cjs")}}})).decision).toBe("deny");
    expect(await f.hook("tool", f.call)).toEqual({decision:"allow"});
  });
});

describe("Antigravity copied image and file validation", () => {
  it("stages the validated private snapshot even if the returned token is mutated", async () => {
    const original = Buffer.from(png);
    const prepared = await prepareAntigravityImageInput({ bytes: original, mimeType: "image/png" });
    const exposed = prepared as unknown as { bytes?: Uint8Array; mimeType?: string };
    exposed.bytes?.fill(0); Reflect.set(exposed, "mimeType", "image/jpeg"); original.fill(1);
    const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "nomi-agy-private-snapshot-"))); dirs.push(cwd);
    const context = await prepareAntigravityMedia(cwd, "vision", [prepared]);
    expect(context.snapshots[0].bytes).toEqual(png);
    expect(context.policy.images[0].path).toMatch(/\.png$/);
  });
  it("rejects forged or cloned prepared media tokens", async () => {
    const prepared = await prepareAntigravityImageInput({ bytes: png, mimeType: "image/png" });
    const clone = { ...(prepared as unknown as Record<string, unknown>) };
    const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "nomi-agy-forged-token-"))); dirs.push(cwd);
    await expect(prepareAntigravityMedia(cwd, "vision", [clone as never]))
      .rejects.toThrow("ANTIGRAVITY_PREPARED_MEDIA_INVALID");
  });
  it("invalidates a prepared media token after exactly one consumption", async () => {
    const prepared = await prepareAntigravityImageInput({ bytes: png, mimeType: "image/png" });
    const first = await realpath(await mkdtemp(path.join(os.tmpdir(), "nomi-agy-first-consume-"))); dirs.push(first);
    const replay = await realpath(await mkdtemp(path.join(os.tmpdir(), "nomi-agy-replay-"))); dirs.push(replay);
    await expect(prepareAntigravityMedia(first, "vision", [prepared])).resolves.toBeDefined();
    await expect(prepareAntigravityMedia(replay, "vision", [prepared]))
      .rejects.toThrow("ANTIGRAVITY_PREPARED_MEDIA_INVALID");
  });
  it("rejects duplicate tokens atomically without consuming the valid token", async () => {
    const prepared = await prepareAntigravityImageInput({ bytes: png, mimeType: "image/png" });
    const duplicate = await realpath(await mkdtemp(path.join(os.tmpdir(), "nomi-agy-duplicate-token-"))); dirs.push(duplicate);
    const retry = await realpath(await mkdtemp(path.join(os.tmpdir(), "nomi-agy-token-retry-"))); dirs.push(retry);
    await expect(prepareAntigravityMedia(duplicate, "vision", [prepared, prepared]))
      .rejects.toThrow("ANTIGRAVITY_PREPARED_MEDIA_INVALID");
    await expect(prepareAntigravityMedia(retry, "vision", [prepared])).resolves.toBeDefined();
  });
  it("fully decodes an image and verifies declared MIME", async () => {
    await expect(validateAntigravityImage(png, "image/png")).resolves.toMatchObject({ width:1,height:1,mimeType:"image/png" });
    await expect(validateAntigravityImage(png, "image/jpeg")).rejects.toThrow("IMAGE_INVALID");
    const corrupt = Buffer.from(png); corrupt.fill(0, 42, 53);
    await expect(validateAntigravityImage(corrupt)).rejects.toThrow("IMAGE_INVALID");
  });
  it("binds the verified image format and complete byte length to the decoder input", () => {
    expect(imageDecoderInputArgs("image/png", 123)).toEqual(["-f", "image2pipe", "-frame_size", "123"]);
    expect(imageDecoderInputArgs("image/jpeg", 456)).toEqual(["-f", "image2pipe", "-frame_size", "456"]);
    expect(imageDecoderInputArgs("image/webp", 19_352)).toEqual(["-f", "webp_pipe", "-frame_size", "19352"]);
  });
  it("fully decodes a static VP8 WebP through the explicit WebP pipe demuxer", async () => {
    const webp = await readFile(path.join(__dirname, "../providerAdapter/__fixtures__/certification-media/valid.webp"));
    await expect(validateAntigravityImage(webp, "image/webp")).resolves.toMatchObject({ width: 960, height: 720, mimeType: "image/webp" });
  });
  it("rejects cancellation before starting the decoder", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(validateAntigravityImage(png, undefined, controller.signal)).rejects.toMatchObject({name:"AbortError"});
  });
  it("refuses traversal, size overflow, symlink files and directory symlinks", async () => {
    const f = await fixture(); await writeFile(path.join(f.cwd,"bytes"),"safe");
    await expect(readAntigravityFile(f.cwd,"../bytes",10)).rejects.toThrow("ARTIFACT_UNSAFE");
    await expect(readAntigravityFile(f.cwd,"bytes",2)).rejects.toThrow("ARTIFACT_UNSAFE");
    let fileLink = false;
    try { await symlink(path.join(f.cwd,"bytes"),path.join(f.cwd,"link")); fileLink = true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM" && process.platform === "win32") {
        // File symlinks require SeCreateSymbolicLinkPrivilege on Windows.
        // Continue with the directory junction assertion below.
      } else throw error;
    }
    if (fileLink) {
      await expect(readAntigravityFile(f.cwd,"link",10)).rejects.toThrow("ARTIFACT_UNSAFE");
    }
    try {
      await symlink(path.join(f.cwd,"task-gate"),path.join(f.cwd,"dir-link"), "junction");
      await expect(readAntigravityFile(f.cwd,"dir-link/plugin.json",1024)).rejects.toThrow("ARTIFACT_UNSAFE");
    } catch (error) {
      if (!((error as NodeJS.ErrnoException).code === "EPERM" && process.platform === "win32")) throw error;
    }
  });
});
