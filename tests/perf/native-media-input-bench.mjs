#!/usr/bin/env node
// Exercise the production native-file boundary through the existing node-json instrument protocol.
// This measures local encoding/validation only, not provider latency or media understanding.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { register } from 'tsx/esm/api';
import { register as registerCjs } from 'tsx/cjs/api';

register();
registerCjs();
const { bindNativeFile, rewriteNativeFilePayload } = await import('../../electron/ai/nativeFilePayload.ts');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const runs = Number(arg('--runs', '5'));
const out = arg('--out', '');
if (!out || !Number.isInteger(runs) || runs < 1) throw new Error('Expected --runs N --out file');

const audio = Buffer.alloc(8 * 1024 * 1024, 0);
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVE', 8);
const video = Buffer.alloc(6 * 1024 * 1024, 0);
video.writeUInt32BE(24, 0); video.write('ftyp', 4); video.write('isom', 8);
const metrics = { transferMs: [] };

function prepare() {
  const start = performance.now();
  const files = [
    bindNativeFile({ type: 'file', data: audio.toString('base64'), mimeType: 'audio/wav', fileName: 'audio.wav' }),
    bindNativeFile({ type: 'file', data: video.toString('base64'), mimeType: 'video/mp4', fileName: 'video.mp4' }),
  ];
  const result = rewriteNativeFilePayload({ contents: [{ role: 'user', parts: files.map(file => ({ text: file.marker })) }] }, 'google-generative-ai', files);
  const elapsed = performance.now() - start;
  assert.equal(result.applied.size, 2);
  assert.equal(result.payload.contents[0].parts[0].inlineData.data, files[0].data);
  assert.equal(result.payload.contents[0].parts[1].inlineData.data, files[1].data);
  return elapsed;
}

let failure;
try {
  prepare();
  for (let i = 0; i < runs; i++) metrics.transferMs.push(prepare());
} catch (error) { failure = String(error?.stack ?? error); }
const report = {
  scope: '14 MiB original audio/video bytes -> base64 validation and complete native request size check; no provider/network calls',
  date: new Date().toISOString(), machine: `${process.platform} ${process.arch} ${os.cpus()[0]?.model}`, node: process.version,
  noisy: false, runs, metrics, ...(failure ? { failure } : {}),
};
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ metrics, failure }));
if (failure) process.exitCode = 1;
