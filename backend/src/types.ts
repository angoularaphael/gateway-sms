export type SmsJobPayload = {
  recipientId: string;
  campaignId: string;
  contactId: string | null;
  phoneNumber: string;
  message: string;
  preferredDevice?: string;
  preferredSim?: number;
};

export type DeviceHeartbeatPayload = {
  deviceId: string;
  appVersion?: string;
  sims: Array<{
    slot: number;
    phoneNumber?: string | null;
    status: "READY" | "ABSENT" | "ERROR" | "UNKNOWN";
  }>;
};

export type SmsResultPayload = {
  recipientId: string;
  success: boolean;
  errorCode?: "NO_SIM" | "DEVICE_OFFLINE" | "SMS_FAILED" | "RATE_LIMIT" | "INVALID_NUMBER" | "UNSUBSCRIBED";
  errorDetail?: string;
};

export type SelectableSim = {
  id: string;
  deviceDbId: string;
  deviceId: string;
  slot: number;
  phoneNumber: string | null;
  status: string;
  dailyLimit: number;
  ratePerMinute: number;
  enabled: boolean;
  lastUsedAt: Date | null;
  sentToday: number;
  sentTodayDate: Date | null;
  deviceOnline: boolean;
};

export type ContactInput = {
  prenom: string;
  nom: string;
  telephone: string;
};
