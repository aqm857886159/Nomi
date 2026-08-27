import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkNetworkEntries, networkEntryViolations } from './check-network-entry.mjs';

it('rejects bare/default/aliased fetch and implicit WebSocket dispatchers', () => {
  for (const source of ['fetch(url)', 'globalThis.fetch(url)', 'const send = fetch',
    'const send = globalThis.fetch', 'function probe(send = fetch) {}', 'new WebSocket(url)']) {
    expect(networkEntryViolations('electron/example.ts', source).length).toBeGreaterThan(0);
  }
});

it('permits app injection, standard fetch types, Chromium sessions and script text', () => {
  const source = `const send: typeof fetch = appFetch;
    const options = { fetch: appFetch };
    send(url); fetchImpl(url); net.fetch(url); view.session.fetch(url);
    new WebSocket(url, { dispatcher });
    const pageScript = 'fetch(blobUrl)';`;
  expect(networkEntryViolations('electron/example.ts', source)).toEqual([]);
});

it('rejects imported alternate Node HTTP clients but permits inbound server creation', () => {
  for (const source of [
    `import * as undici from 'undici'; undici.fetch(url);`,
    `import { fetch as send } from 'undici'; send(url);`,
    `import { request } from 'undici'; request(url);`,
    `import https from 'node:https'; https.request(url);`,
    `import * as http from 'http'; http.get(url);`,
    `const client = require('node:https'); client.request(url);`,
  ]) expect(networkEntryViolations('electron/example.ts', source).length).toBeGreaterThan(0);
  expect(networkEntryViolations('electron/example.ts',
    `import http from 'node:http'; const server = http.createServer(handler);`)).toEqual([]);
});

it('all application-owned Node network calls use the common transport', () => {
  expect(checkNetworkEntries()).toEqual([]);
});

it('route suites explicitly bypass the business-only global fetch fixture', () => {
  for (const file of ['appFetch.test.ts', 'systemProxy.lifecycle.test.ts', 'comfyuiProgressSocket.route.test.ts']) {
    const source = readFileSync(new URL(`../electron/${file}`, import.meta.url), 'utf8');
    expect(source, file).toMatch(/vi\.unmock\(['"]\.\/appFetch['"]\)/);
  }
});
