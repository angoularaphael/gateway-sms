export type SmsResultPlan = {
  ack: boolean | null;
  update: null | {
    status: "SENT" | "DELIVERED" | "FAILED";
    sentAt?: Date;
    deliveredAt?: Date;
    errorCode: string | null;
    errorDetail: string | null;
    markSimUsed?: boolean;
  };
};

/** A missing delivery report must not flip a SMS that already left into FAILED. */
export function planSmsResult(
  input: {
    currentStatus: string;
    success: boolean;
    stage?: string | null;
    errorCode?: string | null;
    errorDetail?: string | null;
    sentAt?: Date | null;
  },
  now = new Date(),
): SmsResultPlan {
  const kind = input.stage === "delivered" ? "delivered" : "sent";
  if (!input.success && kind === "sent" && /sent resultCode=124\b/.test(input.errorDetail || "")) {
    return planSmsResult({ ...input, success: true, errorCode: null, errorDetail: null }, now);
  }

  if (
    !input.success &&
    kind === "sent" &&
    (input.errorCode === "RATE_LIMIT" || /sent resultCode=5\b/.test(input.errorDetail || ""))
  ) {
    return {
      ack: false,
      update: {
        status: "QUEUED",
        errorCode: "RATE_LIMIT",
        errorDetail: input.errorDetail || "limite d’envoi Android, nouvel essai",
      },
    };
  }

  if (input.success && kind === "delivered") {
    return {
      ack: null,
      update: {
        status: "DELIVERED",
        deliveredAt: now,
        sentAt: input.sentAt ?? now,
        errorCode: null,
        errorDetail: null,
      },
    };
  }

  if (input.success) {
    if (input.currentStatus === "DELIVERED") return { ack: true, update: null };
    return {
      ack: true,
      update: {
        status: "SENT",
        sentAt: input.sentAt ?? now,
        errorCode: null,
        errorDetail: null,
        markSimUsed: input.currentStatus !== "SENT",
      },
    };
  }

  if (kind === "delivered") {
    return { ack: null, update: null };
  }

  if (input.currentStatus === "SENT" || input.currentStatus === "DELIVERED") {
    return { ack: true, update: null };
  }

  return {
    ack: false,
    update: {
      status: "FAILED",
      errorCode: input.errorCode ?? "SMS_FAILED",
      errorDetail: input.errorDetail ?? null,
    },
  };
}

export function isFalseDeliveryFailure(errorDetail?: string | null): boolean {
  const detail = errorDetail || "";
  return /delivery resultCode=/i.test(detail) || /non reçu \(accusé réseau\)/i.test(detail);
}
