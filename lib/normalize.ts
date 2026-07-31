/**
 * Normaliseert een URL voor ontdubbeling: lowercase host, geen query-string,
 * geen hash, geen trailing slash, altijd https.
 */
export function normalizeerUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    parsed.search = "";
    parsed.protocol = "https:";
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    return `${parsed.hostname.toLowerCase()}${pathname}`;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

// Unicode-blok combining diacritical marks (U+0300 t/m U+036F), gebruikt om
// accenten te strippen na NFKD-normalisatie. Via charcodes opgebouwd om
// onzichtbare combining characters in de broncode zelf te vermijden.
const COMBINING_MARKS_PATTERN = new RegExp(
  `[\\u0300-\\u036f]`,
  "g",
);

/**
 * Normaliseert titel of werkgever voor fuzzy vergelijking: lowercase,
 * whitespace samengevoegd, leestekens weg.
 */
export function normaliseerTekst(waarde: string | null | undefined): string | null {
  if (!waarde) return null;
  const genormaliseerd = waarde
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS_PATTERN, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return genormaliseerd.length > 0 ? genormaliseerd : null;
}
