import { afterEach, describe, expect, it } from "vitest";
import {
  clearDevicePending,
  enqueuePendingJob,
  peekPendingJobs,
  removePendingJob,
  resetPendingJobsForTests,
} from "../websocket/pendingJobs.js";
import type { SmsJobPayload } from "../types.js";

function job(id: string): SmsJobPayload & { simSlot: number } {
  return {
    recipientId: id,
    campaignId: "c1",
    contactId: null,
    phoneNumber: "+33612345678",
    message: "bonjour",
    simSlot: 1,
  };
}

describe("file d'attente SMS téléphone", () => {
  afterEach(() => {
    resetPendingJobsForTests();
  });

  it("ne donne qu'un SMS à la fois et ne le retire pas au poll", () => {
    enqueuePendingJob("ANDROID-001", job("r1"));
    enqueuePendingJob("ANDROID-001", job("r2"));
    expect(peekPendingJobs("ANDROID-001", 1)).toHaveLength(1);
    expect(peekPendingJobs("ANDROID-001", 1)[0]?.recipientId).toBe("r1");
    expect(peekPendingJobs("ANDROID-001", 1)[0]?.recipientId).toBe("r1");
    expect(peekPendingJobs("ANDROID-001", 2)).toHaveLength(2);
  });

  it("ignore un doublon déjà en file", () => {
    enqueuePendingJob("ANDROID-001", job("r1"));
    enqueuePendingJob("ANDROID-001", job("r1"));
    expect(peekPendingJobs("ANDROID-001", 10)).toHaveLength(1);
  });

  it("retire le SMS seulement après l'accusé du téléphone", () => {
    enqueuePendingJob("ANDROID-001", job("r1"));
    enqueuePendingJob("ANDROID-001", job("r2"));
    removePendingJob("r1");
    expect(peekPendingJobs("ANDROID-001", 1)[0]?.recipientId).toBe("r2");
  });

  it("vide la file d'un appareil supprimé", () => {
    enqueuePendingJob("ANDROID-001", job("r1"));
    clearDevicePending("ANDROID-001");
    expect(peekPendingJobs("ANDROID-001", 1)).toHaveLength(0);
  });
});
