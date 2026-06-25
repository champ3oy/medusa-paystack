import PaystackProviderService from "./service";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function makeProvider(
  Cls: typeof PaystackProviderService = PaystackProviderService,
  options: { secret_key?: string; reference_prefix?: string } = { secret_key: "sk_test" }
) {
  return new Cls({ logger: console } as Record<string, unknown>, options) as InstanceType<typeof PaystackProviderService> & {
    resolveCharge(a: number, c: string): Promise<{ amount: number; currency: string }>;
  };
}

const okInit = {
  ok: true,
  json: async () => ({
    status: true,
    message: "ok",
    data: { access_code: "ac", reference: "ref", authorization_url: "https://pay" },
  }),
};

describe("resolveCharge (default)", () => {
  it("charges the cart amount in the cart currency, uppercased", async () => {
    const p = makeProvider();
    await expect(p.resolveCharge(100, "ngn")).resolves.toEqual({ amount: 100, currency: "NGN" });
  });
});

describe("initiatePayment threading", () => {
  it("charges the resolved amount/currency and records both original and charge values", async () => {
    const calls: Array<{ url: string; init: { body: string } }> = [];
    global.fetch = (async (url: string, init: { body: string }) => {
      calls.push({ url, init });
      return okInit;
    }) as unknown as typeof fetch;

    const p = makeProvider();
    const out = await p.initiatePayment({
      amount: 100,
      currency_code: "ghs",
      context: { customer: { email: "a@b.com" } },
      data: { session_id: "s1" },
    } as Parameters<typeof p.initiatePayment>[0]);

    const body = JSON.parse(calls[0].init.body);
    expect(body.amount).toBe(10000); // 100 * 100
    expect(body.currency).toBe("GHS");
    expect(out.data).toMatchObject({
      amount: 100,
      currency: "GHS",
      charge_amount: 100,
      charge_currency: "GHS",
    });
  });

  it("uses a subclass resolveCharge override as the charge (settlement currency)", async () => {
    const calls: Array<{ url: string; init: { body: string } }> = [];
    global.fetch = (async (url: string, init: { body: string }) => {
      calls.push({ url, init });
      return okInit;
    }) as unknown as typeof fetch;

    class Sub extends PaystackProviderService {
      protected async resolveCharge(amount: number) {
        return { amount: amount * 12, currency: "GHS" };
      }
    }
    const p = makeProvider(Sub);
    const out = await p.initiatePayment({
      amount: 10,
      currency_code: "usd",
      context: { customer: { email: "a@b.com" } },
      data: {},
    } as Parameters<typeof p.initiatePayment>[0]);

    const body = JSON.parse(calls[0].init.body);
    expect(body.amount).toBe(12000); // (10 * 12) * 100
    expect(body.currency).toBe("GHS");
    expect(out.data).toMatchObject({
      amount: 10,
      currency: "USD",
      charge_amount: 120,
      charge_currency: "GHS",
    });
  });
});

describe("authorizePayment uses the charge values", () => {
  function verifyReturning(d: { status: string; currency: string; amount: number }) {
    global.fetch = (async () => ({
      ok: true,
      json: async () => ({ status: true, data: { ...d, reference: "ref" } }),
    })) as unknown as typeof fetch;
  }

  it("captures when Paystack's charge currency/amount match charge_*", async () => {
    verifyReturning({ status: "success", currency: "GHS", amount: 12000 });
    const p = makeProvider();
    const res = await p.authorizePayment({
      data: { reference: "ref", amount: 10, currency: "USD", charge_amount: 120, charge_currency: "GHS" },
    } as Parameters<typeof p.authorizePayment>[0]);
    expect(res.status).toBe("captured");
  });

  it("errors when the charged amount does not match charge_amount", async () => {
    verifyReturning({ status: "success", currency: "GHS", amount: 9999 });
    const p = makeProvider();
    const res = await p.authorizePayment({
      data: { reference: "ref", amount: 10, currency: "USD", charge_amount: 120, charge_currency: "GHS" },
    } as Parameters<typeof p.authorizePayment>[0]);
    expect(res.status).toBe("error");
  });
});

describe("refundPayment scales by the charge ratio", () => {
  function refundCapturing(calls: Array<{ body: string }>) {
    global.fetch = (async (_url: string, init: { body: string }) => {
      calls.push({ body: init.body });
      return { ok: true, json: async () => ({ status: true }) };
    }) as unknown as typeof fetch;
  }

  it("refunds the requested amount as-is when no charge ratio is present (same currency)", async () => {
    const calls: Array<{ body: string }> = [];
    refundCapturing(calls);
    const p = makeProvider();
    await p.refundPayment({
      amount: 25,
      data: { reference: "ref" },
    } as Parameters<typeof p.refundPayment>[0]);
    expect(JSON.parse(calls[0].body)).toEqual({ transaction: "ref", amount: 2500 });
  });

  it("scales the refund by charge_amount/amount for a settled-currency order", async () => {
    const calls: Array<{ body: string }> = [];
    refundCapturing(calls);
    const p = makeProvider();
    await p.refundPayment({
      amount: 5, // refund requested in the original currency
      data: { reference: "ref", amount: 10, charge_amount: 120 },
    } as Parameters<typeof p.refundPayment>[0]);
    // ratio = 120/10 = 12 -> 5 * 12 = 60 major units -> 6000 subunits
    expect(JSON.parse(calls[0].body)).toEqual({ transaction: "ref", amount: 6000 });
  });
});
