import { createHmac } from "crypto";
import {
  assertChargeMatches,
  buildInitializePayload,
  buildRefundPayload,
  makeReference,
  verifyPaystackSignature,
  webhookAction,
} from "./lib";

describe("verifyPaystackSignature", () => {
  const secret = "sk_test_123";
  const body = JSON.stringify({ event: "charge.success" });
  const sign = (b: string, s: string) =>
    createHmac("sha512", s).update(b, "utf8").digest("hex");

  it("accepts a correct signature", () => {
    expect(verifyPaystackSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(verifyPaystackSignature(body, sign(body, "other"), secret)).toBe(false);
  });

  it("rejects a signature of different length", () => {
    expect(verifyPaystackSignature(body, "deadbeef", secret)).toBe(false);
  });
});

describe("webhookAction", () => {
  it("maps charge.success with a session_id to captured (amount in major units)", () => {
    expect(
      webhookAction("charge.success", { amount: 10000, metadata: { session_id: "ses_1" } }, true)
    ).toEqual({ action: "captured", data: { session_id: "ses_1", amount: 100 } });
  });

  it("is not_supported when the signature is invalid", () => {
    expect(
      webhookAction("charge.success", { amount: 10000, metadata: { session_id: "ses_1" } }, false)
    ).toEqual({ action: "not_supported" });
  });

  it("is not_supported when session_id is missing", () => {
    expect(webhookAction("charge.success", { amount: 10000 }, true)).toEqual({
      action: "not_supported",
    });
  });

  it("is not_supported for unrelated events", () => {
    expect(
      webhookAction("charge.failed", { metadata: { session_id: "ses_1" } }, true)
    ).toEqual({ action: "not_supported" });
  });
});

describe("assertChargeMatches", () => {
  const base = { status: "success", amount: 5000, currency: "NGN", expectedAmount: 5000, expectedCurrency: "NGN" };

  it("passes when status, currency, and amount all match", () => {
    expect(assertChargeMatches(base)).toEqual({ ok: true });
  });

  it("is case-insensitive on currency", () => {
    expect(assertChargeMatches({ ...base, currency: "ngn", expectedCurrency: "NGN" })).toEqual({ ok: true });
  });

  it("fails on a non-success status", () => {
    expect(assertChargeMatches({ ...base, status: "failed" })).toEqual({
      ok: false,
      reason: "status failed",
    });
  });

  it("fails on a currency mismatch", () => {
    expect(assertChargeMatches({ ...base, currency: "USD" })).toEqual({
      ok: false,
      reason: "currency USD",
    });
  });

  it("fails on an amount mismatch", () => {
    expect(assertChargeMatches({ ...base, amount: 4000 })).toEqual({
      ok: false,
      reason: "amount 4000 != 5000",
    });
  });
});

describe("makeReference", () => {
  it("uses no prefix by default", () => {
    expect(makeReference("abc")).toBe("abc");
  });

  it("applies a configured prefix", () => {
    expect(makeReference("abc", "FS-")).toBe("FS-abc");
  });
});

describe("buildInitializePayload", () => {
  it("charges in the cart currency (uppercased) with amount in subunits — never GHS", () => {
    expect(
      buildInitializePayload({
        amount: 100,
        currencyCode: "ngn",
        email: "buyer@example.com",
        reference: "ref_1",
        sessionId: "ses_1",
      })
    ).toEqual({
      email: "buyer@example.com",
      amount: 10000,
      currency: "NGN",
      reference: "ref_1",
      metadata: { session_id: "ses_1" },
    });
  });

  it("rounds fractional subunit amounts", () => {
    const payload = buildInitializePayload({
      amount: 19.99,
      currencyCode: "usd",
      email: "a@b.com",
      reference: "r",
    });
    expect(payload.amount).toBe(1999);
    expect(payload.currency).toBe("USD");
  });
});

describe("buildRefundPayload", () => {
  it("refunds the given amount in subunits against the transaction, with no ratio scaling", () => {
    expect(buildRefundPayload("ref_1", 25)).toEqual({
      transaction: "ref_1",
      amount: 2500,
    });
  });
});
