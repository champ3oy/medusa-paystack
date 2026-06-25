# AGENTS.md — integrating `medusa-paystack`

Audience: an AI coding agent (Claude Code, Cursor, etc.) adding Paystack payments to
a user's **Medusa v2** store. Treat this as a checklist. Exact values matter — copy
them verbatim.

## What this package is

- A **Paystack payment provider for Medusa v2** (targets `@medusajs/medusa` **2.16.x**).
- It is a **payment module provider**, resolved at `medusa-paystack/providers/paystack`.
  Provider `identifier` = `paystack`.
- It charges in the **cart's own `currency_code`** — no FX/conversion. The merchant's
  Paystack account must be enabled for those currencies (Paystack supports GHS, NGN,
  ZAR, USD, KES).

## The one thing agents get wrong

This plugin is the **server side only**. It renders **no checkout UI** — no Medusa
payment provider does (the official Stripe plugin is the same). If you only register
the provider, the customer **cannot pay**. You MUST also implement the storefront
step (Section 4), or checkout is broken. Do not report the task complete after
Section 2.

## Gather first

- `PAYSTACK_SECRET_KEY` (backend) and the Paystack **public** key (storefront).
  Test keys look like `sk_test_…` / `pk_test_…`.
- Confirm the backend is on Medusa **2.16.x**: `npm ls @medusajs/medusa`.
- Identify the storefront app (Next.js Medusa starter, custom, etc.) and whether it
  uses `@medusajs/js-sdk`.

## 1. Install (in the Medusa backend)

```bash
npm install medusa-paystack
```

## 2. Register the provider — `medusa-config.ts`

Add it to the **payment module's `providers` array**. Do NOT put it in the top-level
`plugins` array, and do NOT register it as a standalone module.

```ts
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
}
```

If a `@medusajs/medusa/payment` block already exists, **append** to its `providers`
array — do not create a second payment module.

The provider's runtime id becomes `pp_<identifier>_<id>` = **`pp_paystack_paystack`**.
The storefront and webhook depend on this exact string. If you choose a different
`id`, update Sections 4 and 5 to match (`pp_paystack_<id>` and
`/hooks/payment/paystack_<id>`).

## 3. Environment (backend `.env`)

```
PAYSTACK_SECRET_KEY=sk_test_xxx
```

## 4. Storefront — REQUIRED, do not skip

Without this, the provider is registered but no payment can be taken.

- Install the popup lib in the **storefront** app: `npm install @paystack/inline-js`.
- Expose the **public** key to the browser, e.g.
  `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_xxx`.
- Implement a pay button with this flow (using `@medusajs/js-sdk`):
  1. `sdk.store.payment.initiatePaymentSession(cart, { provider_id: "pp_paystack_paystack", data: { email } })`
     — **email is required**; Paystack rejects a session without one.
  2. Read `access_code` from the session whose `provider_id === "pp_paystack_paystack"`.
  3. `new PaystackPop().resumeTransaction(access_code, { onSuccess, onCancel, onError })`
     (from `@paystack/inline-js`). Alternatively redirect the browser to the
     session's `authorization_url`.
  4. On success: `await sdk.store.cart.complete(cartId)` → creates the order.

Copy the full, working component from this package's **README → "Storefront
integration"** and adapt the env-var names to the project. The README also documents
the redirect-based alternative.

## 5. Webhook

In the Paystack dashboard, set the webhook URL to:

```
https://<backend-host>/hooks/payment/paystack_paystack
```

The path segment is `<identifier>_<id>` = `paystack_paystack`. The provider verifies
`x-paystack-signature` (HMAC-SHA512 over the raw body with the secret key) and
captures the session on `charge.success`.

## 6. Enable for regions

Add **Paystack** as a payment provider to each region that should accept it: Admin →
**Settings → Regions**, or via the Admin API.

## 7. Verify before reporting done

- Backend boots with no errors (`npx medusa develop` or the project's dev command).
- Admin shows Paystack as an available provider on a region.
- A test checkout with Paystack **test** keys: pay button → Paystack popup → success
  → order created in Admin.
- Webhook: replay a `charge.success` from the Paystack dashboard and confirm the
  payment session captures.

## Do / Don't

- DO pass the customer email into `initiatePaymentSession` `data`.
- DO use the exact `provider_id` `pp_paystack_paystack` in the storefront and the
  matching `/hooks/payment/paystack_paystack` webhook path.
- DON'T add `medusa-paystack` to the top-level `plugins` array — it's a payment
  provider, registered under the payment module's `providers`.
- DON'T pre-convert amounts to subunits — Medusa passes **major-unit** amounts and
  the provider multiplies by 100 internally.
- DON'T hardcode a currency — the provider uses the cart's `currency_code`.
- DON'T treat the client `onSuccess` as proof of payment — the server re-verifies
  status, amount, and currency in `authorizePayment` during `cart.complete`.

## Options reference

| Option | Required | Default | Notes |
| --- | --- | --- | --- |
| `secret_key` | yes | `process.env.PAYSTACK_SECRET_KEY` | server API calls + webhook signature verification |
| `reference_prefix` | no | `""` | prepended to generated transaction references |

## Provider methods (reference)

`initiatePayment` (creates the Paystack transaction), `authorizePayment` (verifies
status/amount/currency), `capturePayment` (no-op — Paystack auto-captures on
success), `getPaymentStatus`, `refundPayment`, `cancelPayment`/`deletePayment`
(no-ops), `updatePayment` (re-initiates the session), `getWebhookActionAndData`
(signature check + `charge.success` → capture).
