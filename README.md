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

## Storefront flow

`initiatePayment` returns a `data` object containing `authorization_url`,
`access_code`, `reference`, `amount`, and `currency`. Redirect the customer to
`authorization_url` (or use Paystack Inline with `access_code`) to complete payment.
On return, Medusa authorizes the session by verifying the transaction with Paystack.

## Webhook

Create a webhook in your Paystack dashboard pointing at your Medusa server's payment
webhook endpoint for this provider:

```
https://your-backend.com/hooks/payment/paystack_paystack
```

The provider verifies the `x-paystack-signature` (HMAC-SHA512 over the raw body using
your secret key) and captures the payment session on `charge.success`.

## License

MIT
