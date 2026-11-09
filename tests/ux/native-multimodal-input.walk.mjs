// Isolated Windows/macOS/Linux development-build walk; no paid calls or real credentials.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs';
import { openModelSettings, setAppLanguage } from './_shell.mjs';
import { expect, screenshotSettled } from './_assert.mjs';

const output = path.resolve('docs/plan/native-input-ui');
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ data: [{ id: 'custom-omni-model' }] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let gui;
const results = [];
try {
  for (const locale of ['zh-CN', 'en']) {
    gui = await launchNomiApp({ name: `native-input-ui-${locale}`, syntheticCredentialStorage: false });
    const { win } = gui;
    await setAppLanguage(win, locale);
    await win.evaluate(async base => {
      const catalog = window.nomiDesktop.modelCatalog;
      await catalog.upsertVendor({ key: 'native-input-ui', name: 'Native multimodal test', enabled: true,
        authType: 'none', providerKind: 'openai-compatible', baseUrlHint: base });
      await catalog.upsertModel({ vendorKey: 'native-input-ui', modelKey: 'custom-omni-model', labelZh: 'Custom omni model',
        kind: 'text', enabled: true, meta: { supportsImageInput: true, supportsAudioInput: true,
          supportsVideoInput: true, textProviderKind: 'google-generative-ai' } });
    }, `http://127.0.0.1:${server.address().port}/v1`);
    await openModelSettings(win);
    await win.locator('[data-model-home-connection="native-input-ui"]').click();
    await win.getByRole('button', { name: 'Custom omni model', exact: true }).click();
    const openInput = () => win.getByRole('button', { name: /输入与生成方式|inputs and generation/i }).click();
    await openInput();
    const settings = win.locator('[data-native-text-input-settings]');
    await expect(settings).toBeVisible();
    const audioSwitch = settings.locator('input').nth(1);
    await audioSwitch.uncheck({ force: true });
    await win.getByRole('button', { name: /保存能力|save capabilities/i }).click();
    const saved = await win.evaluate(async () => (await window.nomiDesktop.modelCatalog.listModels({ vendorKey: 'native-input-ui' }))
      .find(model => model.modelKey === 'custom-omni-model')?.meta);
    if (saved?.supportsAudioInput !== false || saved?.supportsVideoInput !== true || saved?.textProviderKind !== 'google-generative-ai') {
      throw new Error('Native input settings did not round-trip through the production catalog');
    }
    await openInput();
    await expect(settings).toBeVisible();
    await settings.locator('input').nth(1).check({ force: true });
    await win.getByRole('button', { name: /保存能力|save capabilities/i }).click();
    await openInput();
    await expect(settings).toBeVisible();
    await expect(settings.locator('input').nth(1)).toBeChecked();
    await screenshotSettled(win, { path: path.join(output, `${locale}.png`) });
    results.push({ locale, savedThroughProductionCatalog: true, screenshot: `${locale}.png`, text: await settings.innerText() });
    await closeNomiApp(gui);
    gui = undefined;
  }
} finally {
  if (gui) await closeNomiApp(gui);
  await new Promise(resolve => server.close(resolve));
}
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify(results));
