import { registerAutomationPolicyIpc } from "./automationPolicyIpc";
import { registerGenerationModelDefaultsIpc } from "./generationModelDefaultsIpc";
import { registerProjectLocationIpc } from "./projectLocationIpc";
import { registerSystemPromptsIpc } from "./systemPromptsIpc";
import { hydrateAssetRelayRuntime } from "./assetRelaySettings";
import { registerAssetRelaySettingsIpc } from "./assetRelaySettingsIpc";
import { registerTelemetryIpc } from "./telemetryIpc";
import { registerDiagnosticsIpc } from "../diagnostics/diagnosticsIpc";

export function registerSettingsIpc(): void {
  hydrateAssetRelayRuntime();
  registerProjectLocationIpc();
  registerAutomationPolicyIpc();
  registerAssetRelaySettingsIpc();
  registerSystemPromptsIpc();
  registerGenerationModelDefaultsIpc();
  registerTelemetryIpc();
  // 「隐私与诊断」那一格的另一半：遥测是「发不发出去」，诊断包是「出事时怎么把证据交出来」。
  // 两者同住一个设置区块，接线也放在一起。
  registerDiagnosticsIpc();
}
