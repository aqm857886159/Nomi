export type TuziVideoOrientation = "portrait" | "landscape";

export function normalizeTuziVideoSeconds(
	requestedSeconds: number | null | undefined,
	isProModel: boolean,
): string {
	const requested =
		typeof requestedSeconds === "number" && Number.isFinite(requestedSeconds)
			? Math.max(1, Math.floor(requestedSeconds))
			: 10;

	if (requested === 4 || requested === 8 || requested === 12) {
		return String(requested);
	}
	if (requested <= 10) return "10";
	if (requested <= 15) return "15";
	return isProModel ? "25" : "15";
}

export function normalizeTuziVideoSize(input: {
	sizeRaw: unknown;
	orientation: TuziVideoOrientation;
	isProModel: boolean;
}): string {
	const allowed = input.isProModel
		? new Set(["1280x720", "720x1280", "1024x1792", "1792x1024"])
		: new Set(["1280x720", "720x1280"]);
	const raw = typeof input.sizeRaw === "string" ? input.sizeRaw.trim() : "";
	const compact =
		raw && /^\d+\s*x\s*\d+$/i.test(raw) ? raw.replace(/\s+/g, "") : "";
	if (compact && allowed.has(compact)) return compact;

	const lowered = raw.toLowerCase();
	const wantsHd = lowered === "large" || lowered === "hd" || lowered === "high";

	if (input.orientation === "portrait") {
		return input.isProModel && wantsHd ? "1024x1792" : "720x1280";
	}
	return input.isProModel && wantsHd ? "1792x1024" : "1280x720";
}
