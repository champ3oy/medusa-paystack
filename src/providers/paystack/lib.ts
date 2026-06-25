import { createHmac, timingSafeEqual } from "crypto";

export function verifyPaystackSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export type WebhookEventData = {
  reference?: string;
  amount?: number;
  metadata?: { session_id?: string };
};

export type WebhookActionOutput =
  | { action: "captured"; data: { session_id: string; amount: number } }
  | { action: "not_supported" };

export function webhookAction(
  eventName: string | undefined,
  eventData: WebhookEventData,
  signatureValid: boolean
): WebhookActionOutput {
  if (!signatureValid) return { action: "not_supported" };

  if (eventName === "charge.success") {
    const sid = eventData.metadata?.session_id;
    if (!sid) return { action: "not_supported" };
    return {
      action: "captured",
      data: { session_id: sid, amount: (eventData.amount ?? 0) / 100 },
    };
  }

  return { action: "not_supported" };
}

export function assertChargeMatches(args: {
  status: string;
  amount: number;
  currency: string;
  expectedAmount: number;
  expectedCurrency: string;
}): { ok: true } | { ok: false; reason: string } {
  if (args.status !== "success") return { ok: false, reason: `status ${args.status}` };
  if (args.currency.toUpperCase() !== args.expectedCurrency.toUpperCase())
    return { ok: false, reason: `currency ${args.currency}` };
  if (args.amount !== args.expectedAmount)
    return { ok: false, reason: `amount ${args.amount} != ${args.expectedAmount}` };
  return { ok: true };
}

export function makeReference(seed: string, prefix = ""): string {
  return `${prefix}${seed}`;
}

export function buildInitializePayload(args: {
  amount: number;
  currencyCode: string;
  email: string;
  reference: string;
  sessionId?: string;
}): {
  email: string;
  amount: number;
  currency: string;
  reference: string;
  metadata: { session_id?: string };
} {
  return {
    email: args.email,
    amount: Math.round(args.amount * 100),
    currency: args.currencyCode.toUpperCase(),
    reference: args.reference,
    metadata: { session_id: args.sessionId },
  };
}

export function buildRefundPayload(
  reference: string,
  amount: number
): { transaction: string; amount: number } {
  return { transaction: reference, amount: Math.round(amount * 100) };
}

export type PaystackInitResponse = {
  status: boolean;
  message: string;
  data?: { access_code: string; reference: string; authorization_url: string };
};

export type PaystackVerifyResponse = {
  status: boolean;
  data?: { status: string; amount: number; currency: string; reference: string };
};
