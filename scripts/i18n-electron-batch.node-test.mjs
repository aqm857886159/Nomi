import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const localizedFiles = [
  "electron/audio/synchronousAudioResponse.ts",
  "electron/browser/media/browserMediaValidation.ts",
  "electron/browser/media/browserViewMedia.ts",
  "electron/catalog/apimartMinimaxH3.ts",
  "electron/catalog/comfyuiWorkflowImport.ts",
  "electron/catalog/comfyuiWorkflowOutput.ts",
  "electron/catalog/customCallIpc.ts",
  "electron/catalog/customCallRunner.ts",
  "electron/catalog/runwayOfficial.ts",
  "electron/image/decomposeLayers.ts",
  "electron/review/technicalCheck.ts",
];

test("electron visible-text batch routes every selected source through desktopT", () => {
  for (const relative of localizedFiles) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.match(source, /desktopT\(/, `${relative} should use the desktop translation boundary`);
    assert.doesNotMatch(source, /(?:throw new Error|throw new TypeError)\([^\n]*[\u3400-\u9fff]/u, `${relative} kept a visible CJK throw literal`);
  }
});
