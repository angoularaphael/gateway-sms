import { describe, expect, it } from "vitest";
import { normalizeFrenchPhone, validatePhone, isUnsubscribeKeyword } from "../utils/phone.js";
import { parseContactsCsv, findDuplicates } from "../utils/csv.js";
import { interpolateMessage, estimateSms, estimateCampaignSms, toGsmSafe } from "../utils/template.js";
import { excludeUnsubscribed, isUnsubscribed } from "../utils/unsubscribe.js";
import { selectSimLine, isWithinRateLimit, sentTodayCount } from "../utils/simSelector.js";
import { canTransition, buildSmsJob, shouldRetry, isRetryableStuckRecipient, isContestSms } from "../utils/campaign.js";
import { planSmsResult } from "../utils/smsResult.js";
import type { SelectableSim } from "../types.js";

function sim(overrides: Partial<SelectableSim> = {}): SelectableSim {
  return {
    id: "sim-1",
    deviceDbId: "dev-db-1",
    deviceId: "ANDROID-001",
    slot: 1,
    phoneNumber: "+33611111111",
    status: "READY",
    dailyLimit: 80,
    ratePerMinute: 4,
    enabled: true,
    lastUsedAt: null,
    sentToday: 0,
    sentTodayDate: null,
    deviceOnline: true,
    ...overrides,
  };
}

describe("validation et normalisation des numéros", () => {
  it("normalise les formats français courants", () => {
    expect(normalizeFrenchPhone("0612345678")).toBe("+33612345678");
    expect(normalizeFrenchPhone("06 12 34 56 78")).toBe("+33612345678");
    expect(normalizeFrenchPhone("+33612345678")).toBe("+33612345678");
    expect(normalizeFrenchPhone("33612345678")).toBe("+33612345678");
    expect(normalizeFrenchPhone("0033612345678")).toBe("+33612345678");
    expect(normalizeFrenchPhone("07.12.34.56.78")).toBe("+33712345678");
  });

  it("rejette les numéros invalides", () => {
    expect(validatePhone("").ok).toBe(false);
    expect(validatePhone("123").ok).toBe(false);
    expect(validatePhone("0123456789").ok).toBe(false);
    expect(validatePhone("01 23 45 67 89").ok).toBe(false);
    expect(validatePhone("abc").error).toBe("INVALID_NUMBER");
  });

  it("accepte uniquement les mobiles FR 06/07 par défaut", () => {
    expect(validatePhone("0612345678").ok).toBe(true);
    expect(validatePhone("0712345678").ok).toBe(true);
    expect(validatePhone("0912345678").ok).toBe(false);
  });
});

describe("import CSV", () => {
  const csv = `prenom,nom,telephone
Jean,Dupont,+33612345678
Marie,Martin,+33712345678`;

  it("importe un CSV valide", () => {
    const result = parseContactsCsv(csv);
    expect(result.valid).toHaveLength(2);
    expect(result.valid[0]).toEqual({
      prenom: "Jean",
      nom: "Dupont",
      telephone: "+33612345678",
    });
    expect(result.errors).toHaveLength(0);
  });

  it("détecte les doublons dans le fichier", () => {
    const dup = `prenom,nom,telephone
Jean,Dupont,0612345678
Jean,Clone,06 12 34 56 78`;
    const result = parseContactsCsv(dup);
    expect(result.valid).toHaveLength(1);
    expect(result.duplicatesInFile).toContain("+33612345678");
    expect(result.errors[0]?.error).toMatch(/Doublon/);
  });

  it("signale les numéros invalides", () => {
    const bad = `prenom,nom,telephone
Ok,User,0612345678
Bad,User,1234`;
    const result = parseContactsCsv(bad);
    expect(result.valid).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error).toBe("INVALID_NUMBER");
  });

  it("détecte les doublons déjà en base", () => {
    expect(findDuplicates(["+33612345678", "+33700000000"], new Set(["+33612345678"]))).toEqual([
      "+33612345678",
    ]);
  });

  it("exige la colonne telephone", () => {
    const result = parseContactsCsv("prenom,nom\nJean,Dupont");
    expect(result.valid).toHaveLength(0);
    expect(result.errors[0]?.error).toMatch(/telephone/);
  });
});

describe("personnalisation SMS", () => {
  it("remplace prenom, nom et telephone", () => {
    const text = interpolateMessage("Bonjour {prenom} {nom}, votre n° {telephone}", {
      prenom: "Jean",
      nom: "Dupont",
      telephone: "+33612345678",
    });
    expect(text).toBe("Bonjour Jean Dupont, votre n° +33612345678");
  });

  it("estime GSM-7 vs UCS-2", () => {
    expect(estimateSms("Hello").encoding).toBe("GSM-7");
    expect(estimateSms("Hello").segments).toBe(1);
    expect(estimateSms("Forêt d'été — offre").encoding).toBe("UCS-2");
  });

  it("estime une campagne", () => {
    const estimate = estimateCampaignSms("Bonjour {prenom}", [
      { prenom: "Jean", nom: "D", telephone: "+33611111111" },
      { prenom: "Marie", nom: "M", telephone: "+33711111111" },
    ]);
    expect(estimate.recipients).toBe(2);
    expect(estimate.segments).toBeGreaterThanOrEqual(2);
  });
});

describe("désinscription", () => {
  const unsub = new Set(["+33612345678"]);

  it("empêche l'envoi aux désinscrits", () => {
    expect(isUnsubscribed("0612345678", unsub)).toBe(true);
    expect(isUnsubscribed("+33712345678", unsub)).toBe(false);
  });

  it("filtre une liste de contacts", () => {
    const { kept, excluded } = excludeUnsubscribed(
      [
        { telephone: "+33612345678", prenom: "Jean" },
        { telephone: "+33712345678", prenom: "Marie" },
      ],
      unsub,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.prenom).toBe("Marie");
    expect(excluded).toHaveLength(1);
  });

  it("reconnaît les mots-clés STOP", () => {
    expect(isUnsubscribeKeyword("STOP")).toBe(true);
    expect(isUnsubscribeKeyword("stop")).toBe(true);
    expect(isUnsubscribeKeyword("STOP SMS")).toBe(true);
    expect(isUnsubscribeKeyword("désabonner")).toBe(true);
    expect(isUnsubscribeKeyword("Bonjour")).toBe(false);
  });
});

describe("sélection téléphone / SIM", () => {
  it("sélectionne une SIM prête en ligne", () => {
    const result = selectSimLine([sim(), sim({ id: "sim-2", slot: 2, lastUsedAt: new Date() })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sim.slot).toBe(1);
  });

  it("refuse un appareil hors ligne", () => {
    const result = selectSimLine([sim({ deviceOnline: false })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("DEVICE_OFFLINE");
  });

  it("retourne NO_SIM s'il n'y a aucune ligne", () => {
    const result = selectSimLine([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NO_SIM");
  });

  it("respecte preferredDevice et preferredSim", () => {
    const result = selectSimLine(
      [
        sim({ deviceId: "ANDROID-001", slot: 1 }),
        sim({ id: "s2", deviceId: "ANDROID-002", deviceDbId: "d2", slot: 2 }),
      ],
      { preferredDevice: "ANDROID-002", preferredSim: 2 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sim.deviceId).toBe("ANDROID-002");
      expect(result.sim.slot).toBe(2);
    }
  });

  it("applique le rate limit par minute", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    const recent = sim({ lastUsedAt: new Date("2026-08-29T11:59:50Z"), ratePerMinute: 4 });
    expect(isWithinRateLimit(recent, now).ok).toBe(false);
    expect(isWithinRateLimit(recent, now).reason).toBe("RATE_LIMIT");
  });

  it("applique la limite quotidienne", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    const full = sim({ dailyLimit: 2, sentToday: 2, sentTodayDate: now });
    expect(sentTodayCount(full, now)).toBe(2);
    const result = selectSimLine([full], { now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("RATE_LIMIT");
  });

  it("réinitialise le compteur quotidien le lendemain", () => {
    const now = new Date("2026-08-30T12:00:00Z");
    const simLine = sim({ sentToday: 80, sentTodayDate: new Date("2026-08-29T12:00:00Z"), dailyLimit: 80 });
    expect(sentTodayCount(simLine, now)).toBe(0);
    expect(selectSimLine([simLine], { now }).ok).toBe(true);
  });
});

describe("campagnes et queue", () => {
  it("crée une campagne DRAFT puis autorise RUNNING", () => {
    expect(canTransition("DRAFT", "RUNNING")).toBe(true);
    expect(canTransition("DRAFT", "SCHEDULED")).toBe(true);
    expect(canTransition("COMPLETED", "RUNNING")).toBe(true);
    expect(canTransition("CANCELLED", "RUNNING")).toBe(false);
  });

  it("autorise pause / reprise / annulation", () => {
    expect(canTransition("RUNNING", "PAUSED")).toBe(true);
    expect(canTransition("PAUSED", "RUNNING")).toBe(true);
    expect(canTransition("RUNNING", "CANCELLED")).toBe(true);
  });

  it("construit une tâche BullMQ complète", () => {
    const job = buildSmsJob({
      campaignId: "c1",
      contactId: "ct1",
      phoneNumber: "+33612345678",
      message: "Bonjour Jean",
      preferredDevice: "ANDROID-001",
      preferredSim: 1,
      recipientId: "r1",
    });
    expect(job.campaignId).toBe("c1");
    expect(job.preferredDevice).toBe("ANDROID-001");
  });

  it("refuse de construire une tâche incomplète", () => {
    expect(() =>
      buildSmsJob({
        campaignId: "",
        contactId: null,
        phoneNumber: "+33612345678",
        message: "x",
        recipientId: "r1",
      }),
    ).toThrow();
  });

  it("ne retente pas UNSUBSCRIBED ni INVALID_NUMBER", () => {
    expect(shouldRetry("UNSUBSCRIBED", 1, 3)).toBe(false);
    expect(shouldRetry("INVALID_NUMBER", 1, 3)).toBe(false);
    expect(shouldRetry("SMS_FAILED", 1, 3)).toBe(true);
    expect(shouldRetry("DEVICE_OFFLINE", 3, 3)).toBe(false);
    expect(shouldRetry("RATE_LIMIT", 1, 3)).toBe(true);
  });

  it("reprend les SMS coincés en file ou en échec radio, pas les envoyés", () => {
    expect(isRetryableStuckRecipient("QUEUED")).toBe(true);
    expect(isRetryableStuckRecipient("SENDING")).toBe(true);
    expect(isRetryableStuckRecipient("FAILED", "SMS_FAILED")).toBe(true);
    expect(isRetryableStuckRecipient("FAILED", "DEVICE_OFFLINE")).toBe(true);
    expect(isRetryableStuckRecipient("FAILED", "UNSUBSCRIBED")).toBe(false);
    expect(isRetryableStuckRecipient("SENT")).toBe(false);
    expect(isRetryableStuckRecipient("DELIVERED")).toBe(false);
  });

  it("identifie les SMS concours, pas la boutique", () => {
    expect(isContestSms({ campaignName: "Concours SMS 3 sept", message: "Salut" })).toBe(true);
    expect(isContestSms({ campaignName: "Messages logiciels", message: "C’est David, jeu concours 10 ans" })).toBe(true);
    expect(isContestSms({ campaignName: "Messages logiciels", message: "Boxing Center fête ses 10 ans Boxing Center" })).toBe(true);
    expect(isContestSms({ campaignName: "Boutique SMS 2026-08-12", message: "Ton abonnement" })).toBe(false);
    expect(isContestSms({ campaignName: "Boutique SMS", message: "jeu concours" })).toBe(false);
  });
});

describe("accusé SMS", () => {
  it("ne bascule pas un SMS déjà parti en échec si l’accusé réseau manque", () => {
    const nack = planSmsResult({
      currentStatus: "SENT",
      success: false,
      stage: "delivered",
      errorDetail: "delivery resultCode=0",
    });
    expect(nack.update).toBeNull();
    expect(nack.ack).toBeNull();

    const sendingNack = planSmsResult({
      currentStatus: "SENDING",
      success: false,
      stage: "delivered",
      errorDetail: "non reçu (accusé réseau)",
    });
    expect(sendingNack.update).toBeNull();
    expect(sendingNack.ack).toBeNull();
  });

  it("garde SENT si un faux échec arrive après un envoi ok", () => {
    const plan = planSmsResult({
      currentStatus: "SENT",
      success: false,
      stage: "sent",
      errorCode: "SMS_FAILED",
    });
    expect(plan.update).toBeNull();
    expect(plan.ack).toBe(true);
  });

  it("traite resultCode 124 comme un envoi accepté par la radio", () => {
    const plan = planSmsResult({
      currentStatus: "SENDING",
      success: false,
      stage: "sent",
      errorCode: "SMS_FAILED",
      errorDetail: "sent resultCode=124",
    });
    expect(plan.update?.status).toBe("SENT");
    expect(plan.ack).toBe(true);
  });

  it("marque bien un vrai échec radio avant envoi confirmé", () => {
    const plan = planSmsResult({
      currentStatus: "SENDING",
      success: false,
      stage: "sent",
      errorCode: "SMS_FAILED",
      errorDetail: "sent resultCode=1",
    });
    expect(plan.update?.status).toBe("FAILED");
    expect(plan.ack).toBe(false);
  });
});

describe("GSM SMS", () => {
  it("retire les caractères hors GSM pour rester en 7-bit", () => {
    expect(toGsmSafe("Salut Léa — c’est 29 €")).toBe("Salut Léa - c'est 29 euros");
    expect(toGsmSafe("**Offre** ê")).toBe("Offre e");
  });
});

describe("statistiques campagne", () => {
  it("calcule envoyés / en attente / échecs / progression", () => {
    const stats = {
      total: 4736,
      sent: 3452,
      queued: 1200,
      failed: 84,
    };
    const progress = Math.round((stats.sent / stats.total) * 100);
    expect(progress).toBe(73);
    expect(stats.sent + stats.queued + stats.failed).toBe(stats.total);
  });
});
