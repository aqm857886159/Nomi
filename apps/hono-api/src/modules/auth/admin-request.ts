export function isLocalDevRequest(c: { req?: { url?: string } }): boolean {
	try {
		const url = new URL(String(c.req?.url || ""));
		const host = url.hostname;
		return (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "0.0.0.0" ||
			host === "::1"
		);
	} catch {
		return false;
	}
}

export function isAdminRequest(c: { get: (key: string) => unknown; req?: { url?: string } }): boolean {
	if (isLocalDevRequest(c)) return true;
	const auth = c.get("auth");
	if (!auth || typeof auth !== "object") return false;
	return (auth as { role?: unknown }).role === "admin";
}
