/* global process, console */
import { chromium } from 'playwright';
const D = process.argv[2]; const only = process.argv.slice(3);
const boards = [['Main',1440,340],['Feasible',1440,560],['Vocabulary',1440,1660],['Composer',1440,1000],['FlowCreation',1440,860],['FlowGeneration',1440,860],['FlowPreview',1440,860],['Collapsed',1440,860],['Dark',900,860],['Process',1440,1330],['Rendering',1440,800],['Sources',1440,1180]];
const b = await chromium.launch();
for (const [n,w,h] of boards) { if (only.length && !only.includes(n)) continue;
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.goto(`file://${D}/${n}.dc.html`).catch(()=>{}); await p.waitForTimeout(250);
  await p.screenshot({ path: `${D}/preview-${n}.png`, fullPage: true }); await p.close(); }
await b.close(); console.log('done');
