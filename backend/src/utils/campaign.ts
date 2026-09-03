export const QUEUE_SMS = "sms-send";

export type CampaignLifecycle =
  | "DRAFT"
  | "SCHEDULED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED";

const ALLOWED: Record<CampaignLifecycle, CampaignLifecycle[]> = {
  DRAFT: ["SCHEDULED", "RUNNING", "CANCELLED"],
  SCHEDULED: ["RUNNING", "CANCELLED", "DRAFT"],
  RUNNING: ["PAUSED", "COMPLETED", "CANCELLED"],
  PAUSED: ["RUNNING", "CANCELLED"],
  COMPLETED: ["RUNNING"],
  CANCELLED: [],
};

export function canTransition(from: CampaignLifecycle, to: CampaignLifecycle): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export type SmsJob = {
  campaignId: string;
  contactId: string | null;
  phoneNumber: string;
  message: string;
  preferredDevice?: string;
  preferredSim?: number;
  recipientId: string;
};

export function buildSmsJob(input: SmsJob): SmsJob {
  if (!input.campaignId) throw new Error("campaignId required");
  if (!input.phoneNumber) throw new Error("phoneNumber required");
  if (!input.message) throw new Error("message required");
  if (!input.recipientId) throw new Error("recipientId required");
  return input;
}

export function shouldRetry(errorCode: string | undefined, attempts: number, maxAttempts: number): boolean {
  if (attempts >= maxAttempts) return false;
  if (!errorCode) return true;
  const noRetry = new Set(["UNSUBSCRIBED", "INVALID_NUMBER", "NO_SIM"]);
  return !noRetry.has(errorCode);
}

const STUCK_RETRY_ERRORS = new Set(["SMS_FAILED", "DEVICE_OFFLINE", "RATE_LIMIT", "NO_SIM"]);

export function isRetryableStuckRecipient(status: string, errorCode?: string | null): boolean {
  if (status === "QUEUED" || status === "SENDING") return true;
  return status === "FAILED" && STUCK_RETRY_ERRORS.has(errorCode ?? "");
}

/** SMS du jeu concours 10 ans — à envoyer avant la boutique. */
export function isContestSms(input: { campaignName?: string | null; message?: string | null }): boolean {
  const name = input.campaignName || "";
  const message = input.message || "";
  if (/^Boutique SMS/i.test(name)) return false;
  if (/^Concours SMS/i.test(name)) return true;
  return /jeu concours/i.test(message) || /10 ans Boxing Center/i.test(message);
}
