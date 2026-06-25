import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types";
import { AbstractPaymentProvider } from "@medusajs/framework/utils";
import {
  assertChargeMatches,
  buildInitializePayload,
  buildRefundPayload,
  makeReference,
  PaystackInitResponse,
  PaystackVerifyResponse,
  verifyPaystackSignature,
  webhookAction,
} from "./lib";

type PaystackOptions = {
  secret_key?: string;
  reference_prefix?: string;
};

const PAYSTACK_API = "https://api.paystack.co";

class PaystackProviderService extends AbstractPaymentProvider<PaystackOptions> {
  static identifier = "paystack";

  protected options_: PaystackOptions;
  protected readonly container_: Record<string, unknown>;

  constructor(cradle: Record<string, unknown>, options: PaystackOptions) {
    super(cradle, options);
    this.options_ = options ?? {};
    this.container_ = cradle;
  }

  /**
   * Resolve the amount + currency actually charged at Paystack for a cart.
   * Default: charge the cart's own amount and currency. Override in a subclass
   * to settle in a different currency (e.g. convert every cart to GHS).
   */
  protected async resolveCharge(
    amount: number,
    currency_code: string,
  ): Promise<{ amount: number; currency: string }> {
    return { amount, currency: currency_code.toUpperCase() };
  }

  private get secretKey(): string {
    return this.options_?.secret_key ?? process.env.PAYSTACK_SECRET_KEY ?? "";
  }

  private authHeader(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      "Content-Type": "application/json",
    };
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context } = input;
    const data = input.data as Record<string, unknown> | undefined;

    const email =
      context?.customer?.email ??
      (typeof data?.email === "string" ? data.email : undefined);
    if (!email) {
      throw new Error("Paystack: a customer email is required to initiate payment");
    }

    const { amount: chargeAmount, currency: chargeCurrency } = await this.resolveCharge(
      Number(amount),
      currency_code,
    );

    const seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const reference = makeReference(seed, this.options_.reference_prefix);

    const payload = buildInitializePayload({
      amount: chargeAmount,
      currencyCode: chargeCurrency,
      email,
      reference,
      sessionId: data?.session_id as string | undefined,
    });

    const res = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
      method: "POST",
      headers: this.authHeader(),
      body: JSON.stringify(payload),
    });
    const json: PaystackInitResponse = await res.json();

    if (!json.status || !json.data) {
      throw new Error(`Paystack initiate failed: ${json.message}`);
    }

    const { access_code, authorization_url } = json.data;
    return {
      id: reference,
      data: {
        reference,
        access_code,
        authorization_url,
        amount: Number(amount),
        currency: currency_code.toUpperCase(),
        charge_amount: chargeAmount,
        charge_currency: chargeCurrency,
      },
    };
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = input.data ?? {};
    const reference = data.reference as string;
    if (!reference) return { status: "error", data };

    const res = await fetch(
      `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: this.authHeader() }
    );
    const json: PaystackVerifyResponse = await res.json();
    if (!json.status || !json.data) return { status: "error", data };

    const { status, currency, amount } = json.data;
    const expectedAmount = Math.round(Number(data.charge_amount ?? data.amount ?? 0) * 100);
    const expectedCurrency = String(data.charge_currency ?? data.currency ?? "").toUpperCase();

    const check = assertChargeMatches({
      status,
      currency,
      amount,
      expectedAmount,
      expectedCurrency,
    });

    if (!check.ok) {
      return { status: "error", data: { ...data, ...json.data, reason: check.reason } };
    }
    return { status: "captured", data: { ...data, ...json.data } };
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    // Paystack auto-captures on transaction success; this is a no-op.
    return { data: input.data };
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = input.data ?? {};
    const reference = data.reference as string | undefined;
    if (!reference) return { status: "pending" };

    const res = await fetch(
      `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: this.authHeader() }
    );
    const json: PaystackVerifyResponse = await res.json();
    if (!json.status || !json.data) return { status: "error" };

    switch (json.data.status) {
      case "success":
        return { status: "captured" };
      case "failed":
      case "reversed":
        return { status: "error" };
      case "abandoned":
        return { status: "canceled" };
      default:
        return { status: "pending" };
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = input.data ?? {};
    const reference = data.reference as string;

    // Refund in the charge currency. For carts settled in another currency the
    // ratio scales the requested (original-currency) refund into the charged
    // amount; for same-currency carts the ratio is 1.
    const ratio =
      data.amount && data.charge_amount
        ? Number(data.charge_amount) / Number(data.amount)
        : 1;
    const res = await fetch(`${PAYSTACK_API}/refund`, {
      method: "POST",
      headers: this.authHeader(),
      body: JSON.stringify(buildRefundPayload(reference, Number(input.amount) * ratio)),
    });
    const json = (await res.json()) as { status: boolean; message?: string };

    if (!res.ok || !json.status) {
      throw new Error(
        `Paystack refund failed: ${json.message ?? `HTTP ${res.status}`}`
      );
    }
    return { data };
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    // Paystack has no explicit cancel API for pending transactions.
    return { data: input.data };
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data };
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const data = input.data ?? {};
    const reference = data.reference as string | undefined;
    if (!reference) return { data };

    const res = await fetch(
      `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: this.authHeader() }
    );
    const json: PaystackVerifyResponse = await res.json();
    if (!json.status || !json.data) return { data };
    return { data: { ...data, ...json.data } };
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    // Re-initiate to refresh the session when amount/currency changes;
    // forward input.data so session_id is preserved in Paystack metadata.
    const result = await this.initiatePayment({
      amount: input.amount,
      currency_code: input.currency_code,
      context: input.context,
      data: input.data,
    });
    return { data: result.data };
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const { data, rawData, headers } = payload;
    const signature = (headers["x-paystack-signature"] as string) ?? "";
    const raw = Buffer.isBuffer(rawData) ? rawData.toString("utf8") : String(rawData);
    const signatureValid = verifyPaystackSignature(raw, signature, this.secretKey);

    const event = data as { event?: string; data?: Record<string, unknown> };
    const eventData = (event.data ?? {}) as {
      reference?: string;
      amount?: number;
      metadata?: { session_id?: string };
    };

    return webhookAction(event.event, eventData, signatureValid);
  }
}

export default PaystackProviderService;
