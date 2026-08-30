import { createHash } from "node:crypto";
import type { AntigravityCapability } from "../shared/antigravity";

export type AntigravityMediaPolicy = {
  capability: Exclude<AntigravityCapability, "text">;
  cwd: string;
  nonce: string;
  imageName: string;
  images: Array<{ path: string; sha256: string }>;
};

export function antigravityImageDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Fixed application code, copied outside asar. No renderer content enters command text. */
export function antigravityHookSource(policy: AntigravityMediaPolicy): string {
  return `"use strict";\nconst policy = ${JSON.stringify(policy)};\n` + String.raw`
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const c = fs.constants;
const root = path.join(policy.cwd, 'task-gate');
const deny = () => process.stdout.write(JSON.stringify({decision:'deny',reason:'Nomi task scope denied'}));
function read(file, limit) {
  const fd = fs.openSync(file, c.O_RDONLY | c.O_NOFOLLOW | c.O_NONBLOCK);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size <= 0 || info.size > limit) throw Error();
    const buffer = Buffer.alloc(info.size + 1);
    let used = 0;
    while (used < buffer.length) {
      const n = fs.readSync(fd, buffer, used, buffer.length-used, used);
      if (!n) break;
      used += n;
    }
    if (used !== info.size) throw Error();
    return buffer.subarray(0,used);
  } finally { fs.closeSync(fd); }
}
function claim(file, value) {
  const fd = fs.openSync(file, c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); } finally { fs.closeSync(fd); }
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
let input = ''; let size = 0;
let event; let stage = 'input';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  size += Buffer.byteLength(chunk);
  if (size > 131072) process.exit(1);
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    event = JSON.parse(input);
    if (!object(event)) throw Error();
    if (process.argv[2] === 'init') {
      const marker = path.join(root,'initialized.json');
      if (fs.existsSync(marker)) {
        if (JSON.parse(read(marker,1024)).nonce !== policy.nonce) throw Error();
      } else claim(marker, {nonce:policy.nonce});
      process.stdout.write('{}'); return;
    }
    stage = 'marker';
    if (process.argv[2] !== 'tool'
      || JSON.parse(read(path.join(root,'initialized.json'),1024)).nonce !== policy.nonce
      || JSON.parse(read(path.join(root,'ready.json'),1024)).nonce !== policy.nonce) throw Error();
    const call = event.toolCall;
    stage = 'tool-schema';
    if (!object(call) || !object(call.args)) throw Error();
    const args = call.args;
    stage = 'metadata';
    const meta = ['toolAction','toolSummary'];
    if (meta.some(key => key in args && (typeof args[key] !== 'string' || args[key].length > 4096))) throw Error();
    let index;
    stage = 'tool-scope';
    if (policy.capability === 'vision') {
      if (call.name !== 'view_file' || Object.keys(args).some(key => !['AbsolutePath','StartLine','EndLine','IsSkillFile',...meta].includes(key))
        || ['StartLine','EndLine'].some(key => key in args && (!Number.isSafeInteger(args[key]) || args[key] < 1 || args[key] > 10000000))
        || ('IsSkillFile' in args && args.IsSkillFile !== false)) throw Error();
      index = policy.images.findIndex(image => image.path === args.AbsolutePath);
      if (index < 0) throw Error();
    } else {
      if (call.name !== 'generate_image'
        || Object.keys(args).some(key => !['ImageName','ImagePaths','Prompt','AspectRatio',...meta].includes(key))
        || ('AspectRatio' in args && (typeof args.AspectRatio !== 'string' || !/^[1-9][0-9]?:[1-9][0-9]?$/.test(args.AspectRatio)))
        || args.ImageName !== policy.imageName || typeof args.Prompt !== 'string' || !args.Prompt.trim() || args.Prompt.length > 65536
        || JSON.stringify(args.ImagePaths === undefined ? [] : args.ImagePaths) !== JSON.stringify(policy.images.map(image => image.path))) throw Error();
      index = 0;
    }
    // Recheck staged bytes immediately before authorizing the native tool.
    stage = 'image-bytes';
    for (const image of policy.images) {
      if (path.dirname(image.path) !== path.join(policy.cwd,'inputs')
        || fs.realpathSync(path.dirname(image.path)) !== path.dirname(image.path)
        || crypto.createHash('sha256').update(read(image.path,20971520)).digest('hex') !== image.sha256) throw Error();
    }
    stage = 'budget';
    claim(path.join(root,'authorized-'+index+'.json'), {nonce:policy.nonce,name:call.name,args});
    process.stdout.write(JSON.stringify({decision:'allow'}));
  } catch {
    // Shape-only diagnostics, never values, paths, prompts, or account data.
    try { claim(path.join(root,'denied.json'), {stage, eventKeys:object(event)?Object.keys(event).slice(0,30):[],
      callKeys:object(event?.toolCall)?Object.keys(event.toolCall).slice(0,30):[],
      argTypes:object(event?.toolCall?.args)?Object.fromEntries(Object.entries(event.toolCall.args).map(([k,v])=>[k,Array.isArray(v)?'array':typeof v])):typeof event?.toolCall?.args}); } catch {}
    deny();
  }
});
`;
}

/** Hooks run through the CLI's shell; only constant args and trusted paths appear. */
export function antigravityHookCommand(executable: string, script: string): string {
  // Electron's packaged executable must run as Node, not start another app window.
  if (process.platform === "win32") {
    const quote = (value: string) => `"${value.replace(/(["^&|<>])/g, "^$1")}"`;
    // `cmd /c` (used by Antigravity and tests) parses the command as a batch
    // line. `call` is required for quoted executable paths, especially Node
    // installed under `Program Files`.
    return `set ELECTRON_RUN_AS_NODE=1&&call ${quote(executable)} ${quote(script)}`;
  }
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  return "ELECTRON_RUN_AS_NODE=1 " + quote(executable) + " " + quote(script);
}
