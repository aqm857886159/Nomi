import { registerAutomationPolicyIpc } from "./automationPolicyIpc";
import { registerGenerationModelDefaultsIpc } from "./generationModelDefaultsIpc";
import { registerVendorPreferenceIpc } from "./vendorPreferenceIpc";
import { registerProjectLocationIpc } from "./projectLocationIpc";
import { registerSystemPromptsIpc } from "./systemPromptsIpc";
import { hydrateAssetRelayRuntime } from "./assetRelaySettings";
import { registerAssetRelaySettingsIpc } from "./assetRelaySettingsIpc";
import { registerTelemetryIpc } from "./telemetryIpc";

export function registerSettingsIpc(): void {
  hydrateAssetRelayRuntime();
  registerProjectLocationIpc();
  registerAutomationPolicyIpc();
  registerAssetRelaySettingsIpc();
  registerSystemPromptsIpc();
  registerGenerationModelDefaultsIpc();
  registerVendorPreferenceIpc();
  registerTelemetryIpc();
}
