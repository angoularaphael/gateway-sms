import { validatePhone, type PhoneValidation } from "./phone.js";
import type { ContactInput } from "../types.js";

export type CsvRowResult = {
  line: number;
  raw: Record<string, string>;
  contact?: ContactInput;
  error?: string;
};

export type CsvImportResult = {
  valid: ContactInput[];
  errors: CsvRowResult[];
  duplicatesInFile: string[];
};

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

const HEADER_MAP: Record<string, "prenom" | "nom" | "telephone"> = {
  prenom: "prenom",
  firstname: "prenom",
  nom: "nom",
  lastname: "nom",
  telephone: "telephone",
  tel: "telephone",
  phone: "telephone",
  mobile: "telephone",
  numerodetelephone: "telephone",
};

export function parseContactsCsv(content: string): CsvImportResult {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { valid: [], errors: [{ line: 0, raw: {}, error: "CSV vide" }], duplicatesInFile: [] };
  }

  const headers = parseCsvLine(lines[0]!).map(normalizeHeader);
  const indexes: Partial<Record<"prenom" | "nom" | "telephone", number>> = {};
  headers.forEach((h, i) => {
    const mapped = HEADER_MAP[h];
    if (mapped) indexes[mapped] = i;
  });

  if (indexes.telephone === undefined) {
    return {
      valid: [],
      errors: [{ line: 1, raw: {}, error: "Colonne telephone manquante" }],
      duplicatesInFile: [],
    };
  }

  const seen = new Map<string, number>();
  const duplicatesInFile: string[] = [];
  const valid: ContactInput[] = [];
  const errors: CsvRowResult[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]!);
    const raw = {
      prenom: cells[indexes.prenom ?? -1] ?? "",
      nom: cells[indexes.nom ?? -1] ?? "",
      telephone: cells[indexes.telephone] ?? "",
    };

    const phone: PhoneValidation = validatePhone(raw.telephone);
    if (!phone.ok || !phone.normalized) {
      errors.push({ line: i + 1, raw, error: phone.error ?? "INVALID_NUMBER" });
      continue;
    }

    const previous = seen.get(phone.normalized);
    if (previous !== undefined) {
      duplicatesInFile.push(phone.normalized);
      errors.push({ line: i + 1, raw, error: `Doublon (ligne ${previous})` });
      continue;
    }

    seen.set(phone.normalized, i + 1);
    valid.push({
      prenom: raw.prenom || "—",
      nom: raw.nom || "—",
      telephone: phone.normalized,
    });
  }

  return { valid, errors, duplicatesInFile: [...new Set(duplicatesInFile)] };
}

export function findDuplicates(phones: string[], existing: Set<string>): string[] {
  return phones.filter((p) => existing.has(p));
}
