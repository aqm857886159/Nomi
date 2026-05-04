const VIDEO_CONTENT_TYPE_PREFIX = "video/";

const VIDEO_EXTENSIONS = new Set([
	"mp4",
	"m4v",
	"mov",
	"webm",
]);

const BINARY_CONTENT_TYPES = new Set([
	"application/octet-stream",
	"binary/octet-stream",
	"application/x-mpegurl",
]);

const VIDEO_CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
	mp4: "video/mp4",
	m4v: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
};

function normalizeContentType(value: string | null | undefined): string {
	return String(value || "")
		.split(";")[0]
		?.trim()
		.toLowerCase() || "";
}

function readPathExtension(value: string): string {
	try {
		const parsed = new URL(value);
		const name = parsed.pathname.split("/").pop() || "";
		const dot = name.lastIndexOf(".");
		if (dot < 0) return "";
		return name.slice(dot + 1).trim().toLowerCase();
	} catch {
		const name = value.split("?")[0]?.split("#")[0]?.split("/").pop() || "";
		const dot = name.lastIndexOf(".");
		if (dot < 0) return "";
		return name.slice(dot + 1).trim().toLowerCase();
	}
}

function readContentDispositionFilenameExtension(value: string | null | undefined): string {
	const raw = String(value || "").trim();
	if (!raw) return "";
	const filenamePart = raw
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.toLowerCase().startsWith("filename="));
	if (!filenamePart) return "";
	const filename = filenamePart.slice("filename=".length).trim().replace(/^"|"$/g, "");
	const dot = filename.lastIndexOf(".");
	if (dot < 0) return "";
	return filename.slice(dot + 1).trim().toLowerCase();
}

export function resolveProxyVideoContentType(input: {
	contentType: string | null;
	sourceUrl: string;
	contentDisposition?: string | null;
}): string {
	const contentType = normalizeContentType(input.contentType);
	if (contentType.startsWith(VIDEO_CONTENT_TYPE_PREFIX)) return contentType;

	const urlExtension = readPathExtension(input.sourceUrl);
	const fromUrl = VIDEO_CONTENT_TYPES_BY_EXTENSION[urlExtension];
	if (fromUrl) return fromUrl;

	const dispositionExtension = readContentDispositionFilenameExtension(input.contentDisposition);
	const fromDisposition = VIDEO_CONTENT_TYPES_BY_EXTENSION[dispositionExtension];
	if (fromDisposition) return fromDisposition;

	return "video/mp4";
}

export function isProxyableVideoResponse(input: {
	contentType: string | null;
	sourceUrl: string;
	contentDisposition?: string | null;
	allowBinaryVideoFromKnownHost?: boolean;
}): boolean {
	const contentType = normalizeContentType(input.contentType);
	if (contentType.startsWith(VIDEO_CONTENT_TYPE_PREFIX)) return true;

	const urlExtension = readPathExtension(input.sourceUrl);
	if (urlExtension && VIDEO_EXTENSIONS.has(urlExtension)) {
		return !contentType || BINARY_CONTENT_TYPES.has(contentType) || contentType === "application/mp4";
	}

	const dispositionExtension = readContentDispositionFilenameExtension(input.contentDisposition);
	if (dispositionExtension && VIDEO_EXTENSIONS.has(dispositionExtension)) {
		return !contentType || BINARY_CONTENT_TYPES.has(contentType) || contentType === "application/mp4";
	}

	return Boolean(
		input.allowBinaryVideoFromKnownHost &&
			(!contentType || BINARY_CONTENT_TYPES.has(contentType) || contentType === "application/mp4"),
	);
}
