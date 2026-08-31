const PLACEHOLDERS = ["prenom", "nom", "telephone"] as const;

export function interpolateMessage(
  template: string,
  contact: { prenom?: string; nom?: string; telephone?: string },
): string {
  return template.replace(/\{(prenom|nom|telephone)\}/gi, (_match, key: string) => {
    const value = contact[key.toLowerCase() as (typeof PLACEHOLDERS)[number]];
    return value?.toString() ?? "";
  });
}

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€";

const GSM_FOLD: Record<string, string> = {
  "€": "euros",
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "«": '"',
  "»": '"',
  "—": "-",
  "–": "-",
  "œ": "oe",
  "Œ": "OE",
  ê: "e",
  Ê: "E",
  î: "i",
  Î: "I",
  ô: "o",
  Ô: "O",
  â: "a",
  Â: "A",
  ë: "e",
  ï: "i",
  ü: "u",
  ÿ: "y",
  "*": "",
  "~": "-",
};

export function toGsmSafe(text: string): string {
  let out = "";
  for (const ch of String(text || "")) {
    if (GSM_FOLD[ch] !== undefined) {
      out += GSM_FOLD[ch];
      continue;
    }
    if (GSM7_BASIC.includes(ch) || GSM7_EXTENDED.includes(ch) || ch === "\n" || ch === "\r") {
      out += ch;
      continue;
    }
    if (ch.codePointAt(0)! > 127) continue;
    out += ch;
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
}

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXTENDED.includes(ch)) {
      return false;
    }
  }
  return true;
}

function gsm7Length(text: string): number {
  let len = 0;
  for (const ch of text) {
    len += GSM7_EXTENDED.includes(ch) ? 2 : 1;
  }
  return len;
}

export type SmsEstimate = {
  encoding: "GSM-7" | "UCS-2";
  characters: number;
  segments: number;
};

export function estimateSms(text: string): SmsEstimate {
  if (isGsm7(text)) {
    const characters = gsm7Length(text);
    const segments = characters <= 160 ? 1 : Math.ceil(characters / 153);
    return { encoding: "GSM-7", characters, segments };
  }
  const characters = [...text].length;
  const segments = characters <= 70 ? 1 : Math.ceil(characters / 67);
  return { encoding: "UCS-2", characters, segments };
}

export function estimateCampaignSms(template: string, contacts: Array<{ prenom: string; nom: string; telephone: string }>): {
  recipients: number;
  segments: number;
  sample: SmsEstimate;
} {
  const sample = estimateSms(interpolateMessage(template, contacts[0] ?? { prenom: "Jean", nom: "Dupont", telephone: "+33600000000" }));
  let segments = 0;
  for (const c of contacts) {
    segments += estimateSms(interpolateMessage(template, c)).segments;
  }
  if (contacts.length === 0) {
    segments = sample.segments;
  }
  return { recipients: contacts.length, segments, sample };
}
