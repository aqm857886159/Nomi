/** Public model-discovery diagnostics never contain a credential-bearing URL. */
export function publicModelListUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return "[invalid API address]"; }
}

/** Keep sentence punctuation outside the URL, but retain paired path/IPv6 brackets. */
function redactDiagnosticUrl(raw: string): string {
  // systemProxy appends this prose directly to the URL. Only keep it when neither
  // the address nor suffix contains private URL parts; never split a query secret.
  const sourceSuffix = /（来源：[^（）]+）[)\]）】}.,!?;:，。！？；：、]*$/.exec(raw);
  if (sourceSuffix && !/[?@#]/.test(raw) && publicModelListUrl(raw.slice(0, sourceSuffix.index)) !== "[invalid API address]") return raw;
  const opening: Record<string, string> = { ")": "(", "]": "[", "}": "{", "）": "（", "】": "【" };
  const counts: Record<string, number> = {};
  for (const char of raw) counts[char] = (counts[char] ?? 0) + 1;
  let end = raw.length;
  while (end > 0) {
    const char = raw[end - 1];
    const paired = opening[char];
    if (paired ? counts[char] > (counts[paired] ?? 0) : /[.,!?;:，。！？；：、]/.test(char)) {
      counts[char]--;
      end--;
    } else break;
  }
  const url = raw.slice(0, end);
  const sanitized = publicModelListUrl(url);
  const privateParts = /[?@#]/.test(url);
  const visible = privateParts || sanitized === "[invalid API address]" ? sanitized : url;
  return `${visible}${privateParts ? " [REDACTED]" : ""}${raw.slice(end)}`;
}

/** Redact all caller-supplied header/query values; arbitrary gateway header names can be secrets. */
export function modelListErrorRedactor(
  baseUrl: string,
  headers: Record<string, string>,
  query: Record<string, string> = {},
): (message: string) => string {
  const secrets = [...Object.values(headers), ...Object.values(query)];
  for (const [key, value] of Object.entries(headers)) {
    if (/authorization/i.test(key)) secrets.push(value.replace(/^\S+\s+/, ""));
  }
  try {
    const url = new URL(baseUrl);
    secrets.push(...url.searchParams.values(), url.username, url.password);
  } catch { /* The caller reports invalid addresses without echoing them. */ }
  const variants = new Set<string>();
  for (const secret of secrets.filter(Boolean)) {
    let decoded = secret;
    try { decoded = decodeURIComponent(secret); } catch { /* Already plain text. */ }
    for (const value of [secret, decoded]) {
      const encoded = encodeURIComponent(value);
      variants.add(value);
      variants.add(encoded);
      variants.add(encoded.replace(/%[\dA-F]{2}/g, (part) => part.toLowerCase()));
      variants.add(new URLSearchParams({ value }).toString().slice(6));
      variants.add(encodeURIComponent(encoded));
    }
  }
  const ordered = [...variants].sort((a, b) => b.length - a.length);
  return (message) => {
    let safe = message;
    // Remove complete secrets before punctuation/quotes or the length limit can split them.
    for (const value of ordered) safe = safe.replaceAll(value, "[REDACTED]");
    // Known values can destroy a URL scheme (e.g. X-Forwarded-Proto:https) or private-part
    // delimiter. Fail closed so unknown credentials cannot turn into a public URL/path.
    const urlStructure = /https?:\/\/|[?@#]/gi;
    if ((safe.match(urlStructure)?.length ?? 0) < (message.match(urlStructure)?.length ?? 0)) return "[REDACTED]";
    safe = safe.replace(/https?:\/\/[^\s<>"']+/gi, redactDiagnosticUrl);
    return safe.slice(0, 500);
  };
}
