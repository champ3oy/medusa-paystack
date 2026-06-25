# medusa-paystack

A [Paystack](https://paystack.com) payment provider for **Medusa v2**.

Unlike store-specific forks, this provider charges in the **cart's own currency**
(`currency_code`). Paystack natively supports GHS, NGN, ZAR, USD, and KES — make
sure your Paystack account is enabled for the currencies your store sells in. This
plugin does **not** perform any currency conversion.

## Requirements

- Medusa **2.16.x**
- A Paystack secret key

## Install

```bash
npm install medusa-paystack
```

## Configure

Add the provider to the Payment Module in your `medusa-config.ts`:

```ts
module.exports = defineConfig({
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "medusa-paystack/providers/paystack",
            id: "paystack",
            options: {
              secret_key: process.env.PAYSTACK_SECRET_KEY,
              // reference_prefix: "MY-", // optional, default ""
            },
          },
        ],
      },
    },
  ],
})
```

### Options

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `secret_key` | yes | `process.env.PAYSTACK_SECRET_KEY` | Paystack secret key, used for API calls and webhook signature verification. |
| `reference_prefix` | no | `""` | Prefix prepended to generated transaction references. |

## Enable in the admin

In **Settings → Regions**, add **Paystack** as a payment provider for each region
that should accept it.

## Storefront integration

This plugin is the **server-side** half of the payment flow. Like every Medusa
payment provider (including the official Stripe plugin), it renders **no checkout
UI** — your storefront drives the payment, then completes the cart. The plugin's
job is to start the Paystack transaction and then securely verify the status,
amount, currency, and webhook signature on the server. A storefront cannot accept
payment with the plugin alone; you must add the steps below.

The flow your storefront implements:

1. **Initialize a payment session** on the cart, selecting this provider. The
   provider returns Paystack's `access_code` (and `authorization_url`) in the
   session's `data`.
2. **Collect payment** with Paystack — open Paystack Inline with the `access_code`,
   or redirect the browser to `authorization_url`.
3. **Complete the cart** on success — this triggers the provider's server-side
   verification and creates the order.

### Prerequisites

- Your **Paystack public key** exposed to the browser (e.g.
  `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`). The plugin uses the *secret* key on the
  server; the storefront only needs the *public* key.
- The Medusa JS SDK (`@medusajs/js-sdk`) with your publishable API key.
- For the inline popup: `npm install @paystack/inline-js`.

> **`provider_id`** is `pp_<identifier>_<id>` — `pp_paystack_` plus the `id` you set
> in `medusa-config.ts`. With `id: "paystack"` it is `pp_paystack_paystack`.

### Example (React / Next.js)

```tsx
"use client";

import { useState } from "react";
import Medusa from "@medusajs/js-sdk";

const sdk = new Medusa({
  baseUrl: process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL!,
  publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
});

const PROVIDER_ID = "pp_paystack_paystack"; // must match pp_<identifier>_<id>

export function PayWithPaystack({ cartId, email }: { cartId: string; email: string }) {
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function pay() {
    setLoading(true);
    setError(undefined);
    try {
      // 1. Initialize the Paystack payment session on the cart.
      //    Paystack requires a customer email — pass it in `data`.
      const { cart } = await sdk.store.cart.retrieve(cartId);
      const { payment_collection } = await sdk.store.payment.initiatePaymentSession(
        cart,
        { provider_id: PROVIDER_ID, data: { email } }
      );
      const session = payment_collection.payment_sessions?.find(
        (s) => s.provider_id === PROVIDER_ID
      );
      const accessCode = session?.data?.access_code as string | undefined;
      if (!accessCode) throw new Error("No access_code returned from the payment session");

      // 2. Open Paystack Inline with the access code.
      const mod = await import("@paystack/inline-js");
      const PaystackPop = (mod.default ?? mod) as new () => {
        resumeTransaction(
          accessCode: string,
          cb: {
            onSuccess?: () => void;
            onCancel?: () => void;
            onError?: (e: { message: string }) => void;
          }
        ): void;
      };

      new PaystackPop().resumeTransaction(accessCode, {
        onSuccess: async () => {
          // 3. Complete the cart -> runs the provider's server-side verification
          //    (status + amount + currency) and creates the order.
          const res = await sdk.store.cart.complete(cartId);
          if (res.type === "order") {
            window.location.href = `/order/confirmed/${res.order.id}`;
          } else {
            setError(res.error?.message ?? "Order could not be completed.");
          }
        },
        onCancel: () => setError("Payment cancelled — your cart is still saved."),
        onError: (e) => setError(e.message),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start payment.");
      setLoading(false);
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <button onClick={pay} disabled={loading}>
        {loading ? "Starting…" : "Pay with Paystack"}
      </button>
    </div>
  );
}
```

The same three SDK calls work in any frontend framework — only the
`@paystack/inline-js` popup call is Paystack-specific.

### Redirect instead of inline

If you prefer a full-page redirect over the popup, skip `@paystack/inline-js`:
read `authorization_url` from the session `data`, send the browser there, and on
return to your callback page call `sdk.store.cart.complete(cartId)`.

> The server is always authoritative: `cart.complete` runs the provider's
> `authorizePayment`, which re-checks the transaction status, amount, and currency
> with Paystack before the order is created. Never treat the client `onSuccess` as
> proof of payment on its own.

## Webhook

Create a webhook in your Paystack dashboard pointing at your Medusa server's payment
webhook endpoint for this provider:

```
https://your-backend.com/hooks/payment/paystack_paystack
```

The path segment is `<identifier>_<id>` — the provider's identifier (`paystack`)
joined with the `id` from your `medusa-config.ts`. With `id: "paystack"` the segment
is `paystack_paystack`; had you registered the provider with `id: "main"`, the path
would be `/hooks/payment/paystack_main`.

The provider verifies the `x-paystack-signature` (HMAC-SHA512 over the raw body using
your secret key) and captures the payment session on `charge.success`.

## License

MIT
