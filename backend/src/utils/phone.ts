export const UNSUBSCRIBE_KEYWORDS = [
  "STOP",
  "STOPSMS",
  "ARRET",
  "ARRÊT",
  "DESABONNER",
  "DÉSABONNER",
  "DESINSCRIPTION",
  "DÉSINSCRIPTION",
] as const;

const FR_MOBILE_RE = /^\+33[67]\d{8}$/;
const E164_RE = /^\+[1-9]\d{7,14}$/;

export type PhoneValidation = {
  ok: boolean;
  normalized: string | null;
  error?: "EMPTY" | "INVALID_NUMBER";
};

export function stripPhone(raw: string): string {
  return raw.replace(/[\s.\-()]/g, "").trim();
}

/**
 * Normalise un numéro français vers E.164 (+33…).
 * Accepte 06…, 07…, 336…, +336…, 00336…
 */
export function normalizeFrenchPhone(raw: string): string | null {
  if (!raw) return null;
  let digits = stripPhone(raw);

  if (digits.startsWith("00")) {
    digits = `+${digits.slice(2)}`;
  }

  if (digits.startsWith("+")) {
    if (digits.startsWith("+33") && digits.length === 12) {
      return digits;
    }
    return E164_RE.test(digits) ? digits : null;
  }

  if (digits.startsWith("33") && digits.length === 11) {
    return `+${digits}`;
  }

  if (/^0[1-9]\d{8}$/.test(digits)) {
    return `+33${digits.slice(1)}`;
  }

  return null;
}

export function validatePhone(raw: string, frenchMobileOnly = true): PhoneValidation {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return { ok: false, normalized: null, error: "EMPTY" };
  }

  const normalized = normalizeFrenchPhone(trimmed);
  if (!normalized) {
    return { ok: false, normalized: null, error: "INVALID_NUMBER" };
  }

  if (frenchMobileOnly && !FR_MOBILE_RE.test(normalized)) {
    return { ok: false, normalized, error: "INVALID_NUMBER" };
  }

  if (!E164_RE.test(normalized)) {
    return { ok: false, normalized: null, error: "INVALID_NUMBER" };
  }

  return { ok: true, normalized };
}

export function isUnsubscribeKeyword(body: string): boolean {
  const token = body
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();
  const compact = token.replace(/\s+/g, "");
  const first = token.split(/\s+/)[0] ?? "";
  return UNSUBSCRIBE_KEYWORDS.some((kw) => {
    const normalizedKw = kw.normalize("NFD").replace(/\p{Diacritic}/gu, "");
    return first === normalizedKw || token === normalizedKw || compact === normalizedKw;
  });
}
