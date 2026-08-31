import { registerAutomationPolicyIpc } from "./automationPolicyIpc";
import { registerProjectLocationIpc } from "./projectLocationIpc";
import { registerVideoAnalysisSettingsIpc } from "./videoAnalysisSettingsIpc";

export function registerSettingsIpc(): void {
  registerProjectLocationIpc();
  registerAutomationPolicyIpc();
  registerVideoAnalysisSettingsIpc();
}
