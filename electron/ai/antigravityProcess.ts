import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { mkdtemp, mkdir, open, realpath, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AntigravityProtocol, type AntigravityResult, type AntigravityToolStep } from "./antigravityProtocol";

import type { AntigravityCapability } from "../shared/antigravity";
import { assertAntigravityMediaInput, assertPreparedAntigravityMediaInput, prepareAntigravityImageInput,
  prepareAntigravityMedia, stageAntigravityMedia, finishAntigravityMedia, type AntigravityImageInput,
  type PreparedAntigravityImageInput } from "./antigravityMedia";

export type AntigravityInvocation = { command: string; args: string[] };
export type AntigravityExecutableIdentity = {
  realpath: string; dev: string; ino: string; size: string; mtimeNs: string; ctimeNs: string;
};
export type PreparedAntigravityInvocation = {
  invocation: AntigravityInvocation;
  identity: AntigravityExecutableIdentity;
  env: NodeJS.ProcessEnv;
};
export type AntigravityRunOptions = {
  capability?: AntigravityCapability;
  images?: AntigravityImageInput[];
  /** Exact version from trusted main-process discovery, required for media. */
  cliVersion?: string;
  prompt: string;
  model?: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
};
type ProcessOptions = {
  /** Main-process test seam, never supplied by the renderer. */
  invocation?: AntigravityInvocation;
  /** Exact main-process invocation returned by discovery/preflight. */
  preparedInvocation?: PreparedAntigravityInvocation;
  /** Main-owned opaque media tokens returned by paid-operation preflight. */
  preparedImages?: PreparedAntigravityImageInput[];
  initTimeoutMs?: number;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_PROFILE_LOG_BYTES = 2 * 1024 * 1024;

/** CLI 1.1.21 logs missing-agent fallback before init, but not on stderr. */
async function verifyProfileSelection(logPath: string): Promise<void> {
  try {
    const file = await open(logPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile() || !info.size || info.size > MAX_PROFILE_LOG_BYTES) throw new Error("invalid log");
      const buffer = Buffer.alloc(MAX_PROFILE_LOG_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const log = buffer.subarray(0, bytesRead).toString("utf8");
      if (bytesRead > MAX_PROFILE_LOG_BYTES || !log.trim()) throw new Error("invalid log");
      if (/Agent "[^"\r\n]+" not found, falling back to default/.test(log)) throw new Error("agent fallback");
    } finally { await file.close(); }
  } catch {
    // Never expose CLI diagnostics: they can contain account or prompt data.
    throw new Error("ANTIGRAVITY_PROFILE_UNVERIFIED");
  }
}

export function resolveAntigravityBin(): string {
  const name = process.platform === "win32" ? "agy.exe" : "agy";
  const candidates = [path.join(os.homedir(), ".local", "bin", name),
    ...(process.platform === "win32" ? [path.join(os.homedir(), "AppData", "Local", "agy", "bin", name)] : []),
    ...((process.env.PATH || "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, name)))];
  return candidates.find((candidate) => path.isAbsolute(candidate) && existsSync(candidate)) || name;
}

async function executableIdentity(command: string, env: NodeJS.ProcessEnv): Promise<AntigravityExecutableIdentity> {
  try {
    let resolved = "";
    const hasPath = path.isAbsolute(command) || command.includes("/") || command.includes("\\");
    if (hasPath) resolved = await realpath(command);
    else {
      const extensions = process.platform === "win32"
        ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").flatMap((extension) => ["", extension.toLowerCase(), extension.toUpperCase()])
        : [""];
      for (const directory of (env.PATH || "").split(path.delimiter).filter(Boolean)) {
        for (const extension of extensions) {
          try { resolved = await realpath(path.join(directory, command + extension)); break; } catch { /* keep searching */ }
        }
        if (resolved) break;
      }
      if (!resolved) throw Object.assign(new Error("ANTIGRAVITY_NOT_INSTALLED"), { code: "ENOENT" });
    }
    const info = await stat(resolved, { bigint: true });
    if (!info.isFile()) throw new Error("ANTIGRAVITY_EXECUTABLE_INVALID");
    return { realpath: resolved, dev: String(info.dev), ino: String(info.ino), size: String(info.size),
      mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ANTIGRAVITY_")) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw Object.assign(new Error(code === "ENOENT" ? "ANTIGRAVITY_NOT_INSTALLED" : "ANTIGRAVITY_EXECUTABLE_INVALID"), { cause: error });
  }
}

export async function prepareAntigravityInvocation(input: {
  invocation?: AntigravityInvocation; env?: NodeJS.ProcessEnv;
} = {}): Promise<PreparedAntigravityInvocation> {
  const env = input.env ?? buildAntigravityEnv();
  const invocation = input.invocation ?? { command: resolveAntigravityBin(), args: [] };
  const identity = await executableIdentity(invocation.command, env);
  return { invocation: { command: identity.realpath, args: [...invocation.args] }, identity,
    env };
}

export async function assertPreparedAntigravityInvocation(prepared: PreparedAntigravityInvocation): Promise<void> {
  const current = await executableIdentity(prepared.invocation.command, prepared.env);
  if (Object.keys(prepared.identity).some((key) => current[key as keyof AntigravityExecutableIdentity]
    !== prepared.identity[key as keyof AntigravityExecutableIdentity])) {
    throw new Error("ANTIGRAVITY_EXECUTABLE_CHANGED");
  }
}

/** Preserve CLI login locations, not arbitrary app/API secrets. No token file reads. */
export function buildAntigravityEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = ["HOME", "USERPROFILE", "PATH", "SystemRoot", "WINDIR", "APPDATA", "LOCALAPPDATA",
    "TMP", "TEMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM"];
  return Object.fromEntries(allowed.filter((key) => base[key] !== undefined).map((key) => [key, base[key]]));
}

function abortError(): Error { return Object.assign(new Error("ANTIGRAVITY_CANCELLED"), { name: "AbortError" }); }
function failureFromExit(stderr: string): Error {
  if (/please sign in|authentication required|not authenticated|login required|unauthorized/i.test(stderr)) {
    return new Error("ANTIGRAVITY_LOGIN_REQUIRED");
  }
  if (/quota|rate.?limit|resource.exhausted|too many requests/i.test(stderr)) return new Error("ANTIGRAVITY_QUOTA");
  return new Error("ANTIGRAVITY_PROCESS_FAILED");
}

export async function runAntigravityProcess(input: AntigravityRunOptions, options: ProcessOptions = {}): Promise<AntigravityResult> {
  // Windows needs a Job Object to own descendants even after the CLI exits.
  // Do not advertise bounded cancellation there until that boundary exists.
  // A prepared invocation is the authenticated result of main-process discovery
  // and is safe to use on Windows just like the explicit test seam invocation.
  if (process.platform === "win32" && !options.invocation && !options.preparedInvocation) {
    throw new Error("ANTIGRAVITY_PLATFORM_UNVERIFIED");
  }
  if (input.signal?.aborted) throw abortError();
  if (!input.prompt.trim()) throw new Error("ANTIGRAVITY_EMPTY_PROMPT");
  if (input.model && !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(input.model)) throw new Error("ANTIGRAVITY_INVALID_MODEL");
  const capability = input.capability ?? "text";
  if (options.preparedImages) {
    if (input.images !== undefined) throw new Error("ANTIGRAVITY_PREPARED_MEDIA_INVALID");
    assertPreparedAntigravityMediaInput(capability, options.preparedImages, input.cliVersion);
  } else assertAntigravityMediaInput(capability, input.images ?? [], input.cliVersion);
  if (options.preparedInvocation) await assertPreparedAntigravityInvocation(options.preparedInvocation);
  const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "nomi-antigravity-")));
  const agentName = "nomi-" + capability + "-" + randomUUID();
  try {
    const preparedImages = options.preparedImages ?? await Promise.all((input.images ?? [])
      .map((image) => prepareAntigravityImageInput(image, input.signal)));
    const media = capability === "text" ? undefined : await prepareAntigravityMedia(cwd, capability, preparedImages, input.signal);
    const agentDir = path.join(cwd, ".agents", "agents", agentName);
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, "agent.md"), [
      "---", "name: " + agentName, "description: Nomi bounded generation", "tools: " + JSON.stringify(media?.tools ?? []),
      ...(media ? ["plugins: " + JSON.stringify([media.plugin])] : []),
      "mainAgent: true", "subagent: false", 'commandExecutionPolicy: "off"',
      "inheritCustomizations: false", "---", "# System Prompt",
      media?.system ?? "Return only the requested text. Do not use tools or access files.",
    ].join("\n"), { mode: 0o600 });
    if (input.signal?.aborted) throw abortError();
    const invocation = options.preparedInvocation?.invocation || options.invocation || { command: resolveAntigravityBin(), args: [] };
    const logPath = path.join(cwd, "cli.log");
    const args = [...invocation.args, "--add-dir", cwd, "--log-file", logPath, "--agent", agentName, "--input-format", "stream-json",
      "--output-format", "stream-json", "--disable-slash-commands", "--sandbox",
      "--print-timeout", media ? "240s" : "120s", ...(input.model && input.model !== "auto" ? ["--model", input.model] : [])];
    const environment = options.preparedInvocation?.env ?? options.env ?? buildAntigravityEnv();
    const home = media ? await realpath(environment.HOME ?? os.homedir()) : undefined;
    if (options.preparedInvocation) await assertPreparedAntigravityInvocation(options.preparedInvocation);
    let toolSteps: AntigravityToolStep[] = [];
    const result = await new Promise<AntigravityResult>((resolve, reject) => {
      const child = spawn(invocation.command, args, { cwd, env: home ? { ...environment, HOME: home } : environment, shell: false,
        detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let failure: Error | undefined;
      let closed = false;
      let buffer = "";
      let stderr = "";
      let bytes = 0;
      let readiness = Promise.resolve();
      let mediaReady = false;
      let mediaPreparing = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      const killOwnedGroup = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try {
          if (process.platform !== "win32") process.kill(-child.pid, signal);
          else child.kill(signal); // Test fixture only; real Windows execution is gated above.
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(signal);
        }
      };
      const cleanupOwnedGroup = async () => {
        // close only confirms the direct child's pipes closed, not its descendants.
        // On every terminal path kill the remaining group before deleting its cwd.
        killOwnedGroup("SIGKILL");
        if (process.platform === "win32" || !child.pid) return;
        const deadline = Date.now() + 1_000;
        while (true) {
          try { process.kill(-child.pid, 0); }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === "ESRCH") return;
            // macOS can briefly return EPERM while the killed group is reaped.
            // Only ESRCH confirms cleanup; persistent denial remains a failure.
            if (code !== "EPERM" || Date.now() >= deadline) throw Object.assign(new Error("ANTIGRAVITY_CLEANUP_FAILED"), { cause: error });
          }
          if (Date.now() >= deadline) throw new Error("ANTIGRAVITY_CLEANUP_TIMEOUT");
          await delay(20);
        }
      };
      const stop = (error: Error) => {
        if (failure) return;
        failure = error;
        if (closed) return;
        child.stdin.destroy();
        killOwnedGroup("SIGTERM");
        killTimer = setTimeout(() => { if (!closed) killOwnedGroup("SIGKILL"); }, 750);
        killTimer.unref();
      };
      const onAbort = () => stop(abortError());
      // Authenticated cold startup has exceeded 10s in the real CLI; still bounded independently of generation.
      const initTimer = setTimeout(() => stop(new Error("ANTIGRAVITY_INIT_TIMEOUT")), options.initTimeoutMs ?? 30_000);
      const overallTimer = setTimeout(() => stop(new Error("ANTIGRAVITY_TIMEOUT")), options.timeoutMs ?? (media ? 245_000 : 125_000));
      const parser = new AntigravityProtocol(() => {
        readiness = (options.preparedInvocation
          ? assertPreparedAntigravityInvocation(options.preparedInvocation)
          : Promise.resolve()).then(() => verifyProfileSelection(logPath)).then(() => {
          clearTimeout(initTimer);
          if (!failure && !closed && !input.signal?.aborted) {
            // EOF ends the session after this single turn. No global --continue.
            const line = JSON.stringify({ event: "user", message: { content: media?.handshake ?? input.prompt } }) + "\n";
            if (media) child.stdin.write(line); else child.stdin.end(line);
          }
        }).catch(stop);
      }, (delta) => { if (!media) input.onDelta?.(delta); }, {
        agent: agentName, cwd, capability: "text", ...(input.model && input.model !== "auto" ? { model: input.model } : {}),
      });
      const boundDrain = () => {
        drainTimer ??= setTimeout(() => stop(new Error("ANTIGRAVITY_DRAIN_TIMEOUT")), 2_000);
      };
      const acceptLine = (line: string) => {
        if (!line.trim() || failure) return;
        try {
          parser.accept(JSON.parse(line));
          if (parser.completed && media && !mediaReady) {
            if (mediaPreparing || parser.finish().text.trim() !== media.handshake) throw new Error("ANTIGRAVITY_HOOK_UNVERIFIED");
            mediaPreparing = true;
            readiness = stageAntigravityMedia(media).then(() => {
              if (failure || closed || input.signal?.aborted) return;
              mediaReady = true;
              parser.nextTurn(capability, capability === "vision" ? media.policy.images.length : 1);
              child.stdin.end(JSON.stringify({ event: "user", message: { content: input.prompt } }) + "\n");
            }).catch(stop);
          } else if (parser.completed) boundDrain();
        }
        catch (error) { stop(error instanceof SyntaxError ? new Error("ANTIGRAVITY_INVALID_JSON") : error as Error); }
      };
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_OUTPUT_BYTES) { stop(new Error("ANTIGRAVITY_OUTPUT_LIMIT")); return; }
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); acceptLine(line);
        }
      });
      child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-65_536); });
      // EPIPE can race process exit; close/exit retains the authoritative error.
      child.stdin.on("error", () => {});
      child.on("error", (error: NodeJS.ErrnoException) => {
        failure ??= new Error(error.code === "ENOENT" ? "ANTIGRAVITY_NOT_INSTALLED" : "ANTIGRAVITY_PROCESS_FAILED");
      });
      child.on("exit", boundDrain);
      child.on("close", (code) => {
        closed = true;
        clearTimeout(initTimer); clearTimeout(overallTimer); if (killTimer) clearTimeout(killTimer);
        if (drainTimer) clearTimeout(drainTimer);
        input.signal?.removeEventListener("abort", onAbort);
        void Promise.all([cleanupOwnedGroup(), readiness]).then(() => {
          if (input.signal?.aborted) failure ??= abortError();
          if (failure) { reject(failure); return; }
          if (code !== 0) { reject(failureFromExit(stderr)); return; }
          acceptLine(buffer);
          if (failure) { reject(failure); return; }
          try { const result = parser.finish(); toolSteps = parser.toolSteps; resolve(result); } catch (error) { reject(error); }
        }, reject);
      });
      input.signal?.addEventListener("abort", onAbort, { once: true });
      if (input.signal?.aborted) onAbort();
    });
    if (!media) return result;
    const verified = await finishAntigravityMedia(media, result, toolSteps, home!, input.signal);
    if (input.signal?.aborted) throw abortError();
    input.onDelta?.(verified.text);
    return verified;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
