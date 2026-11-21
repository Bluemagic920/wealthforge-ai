# Business membership launch

November 21 update: the approved live rollout now reuses the credentials and webhook already configured in the existing Pro billing Worker. See [BUSINESS_SHARED_LIVE.md](BUSINESS_SHARED_LIVE.md) for the current deployment architecture and gates. Older separate-service setup steps below are historical and do not require new keys or another account login.

Business ($129.99 a month or $1,325.90 a year, 20 employees) is bought on profitharborai.com and unlocks Ironcrest Workforce Operations.

## How it works

1. A signed-in ProfitHarbor account chooses Business under Account.
2. `worker/business-api.mjs` (Worker `profitharbor-business-api`) creates the buyer's Ironcrest company, maps a Stripe customer to it, and returns a Stripe Checkout link.
3. Stripe sends subscription events to the Business billing webhook, which records the paid subscription in `ironcrest_billing_snapshots`.
4. `ironcrest_business_entitlement` (updated by `docs/business-checkout.sql`) grants Ironcrest access while a live subscription is active and paid.

The site keeps its "Coming Soon" wording until the Business API reports live checkout open, so this change is safe to publish before anything else is deployed.

## Go-live steps

1. **Database.** Applied to production on November 16, 2026 (migrations `ironcrest_business_checkout_onboarding` and `ironcrest_business_checkout_remove_auth_lookup`). `docs/business-checkout.sql` is the combined result. It adds one function and replaces `ironcrest_business_entitlement`; results for lifetime owners and the legacy subscription table are unchanged. It creates no tables and changes no rows.
2. **Business API Worker.** Created and deployed as `profitharbor-business-api` from `worker/business-api.mjs`. On November 21 the owner entered both secrets securely, and the service reported `configured=true`, `mode=test`, `checkoutOpen=true`. Version `013d2b57` additionally verifies the Stripe account and both catalog prices during authenticated test status reads. An actual signed-in status read succeeded after deployment, verifying the saved Stripe and database credentials without starting a purchase. The site calls `https://profitharbor-business-api.bluemagic920.workers.dev`; if the name differs, update `API` in `ph-business.js`. Settings:
   - `BUSINESS_STRIPE_MODE`: `test` first, later `live`
   - `BUSINESS_STRIPE_KEY` (secret): Stripe key for that mode
   - `SUPABASE_SERVICE_ROLE_KEY` (secret)
   - `ENABLE_BUSINESS_CHECKOUT`: `true` for the approved test flow; live charging remains blocked by the source approval gate
   - `BUSINESS_WEBHOOK_READY`: `true` only after the matching account's signed webhook and paid-invoice access update have been verified
   - `BUSINESS_CHECKOUT_ATTEMPTS_READY`: `true` only after the approved `docs/business-checkout-attempts.sql` migration is installed
   - Live checkout additionally requires the reviewed release to pass `productionApproved: true` to `createBusinessApi`; the checked-in default keeps live charging closed regardless of environment flags.
3. **Test-mode run.** With the Worker in `test` mode, sign in on the site, open Account, and buy Business with a Stripe test card. The staging Worker's Business webhook already records test events. Expected: the panel shows "TEST MODE" and "Your Business membership is active". Test payments never unlock the live Ironcrest workspace. Use a fresh account for this: the owner account has lifetime Business and is stopped before checkout.
4. **Production webhook.** Deploy the Business billing webhook for live mode (`productionApproved: true`, `BUSINESS_STRIPE_MODE=live`, live key, live webhook secret, `ENABLE_BUSINESS_BILLING=true`) and register its `/api/business/billing/webhook` URL in Stripe live mode. This is not part of this change.
5. **Pro features for Business.** A tested candidate now adds verified live Business access to `profitharbor-ai-live-api` billing status and AI authorization, and stops Business buyers from purchasing duplicate Pro subscriptions. Build with `node tools/build-business-pro-access.cjs tests/helpers/pro-live-baseline.mjs <output-path>`. The builder pins the inspected live version `c4e122c3` by SHA-256 and refuses a changed baseline. Compare it with the currently deployed source again before deployment. Existing Pro and lifetime Pro reads stay independent of Business lookups. The candidate requires `BUSINESS_PRO_ACCESS_READY=true` and is **not deployed**; deploying it is a production approval gate.
6. **Switch to live, after explicit approval.** Review and deploy the production-approved build, install the approved checkout-attempt migration, enter the live credentials securely, verify the live webhook, and enable the readiness and checkout flags. The site then shows "Choose Business".

## November 20 checkout completion work

The previously missing `profitharbor-business-api` service has been created. Checkout now reserves one durable attempt per account and mode before creating a Stripe session. Monthly/annual and cross-browser requests share that reservation; retries use persisted parameters and the same Stripe idempotency key. Only a server-retrieved, verified expired session allows a new attempt. A lost response without a saved session becomes a support review if the safe retry window expires; it never silently starts another payment.

`docs/business-checkout-attempts.sql` creates a service-only table and function. Following explicit owner approval, it was applied to the hosted database on November 21 as `ironcrest_business_checkout_attempt_reservation`. Verification confirmed RLS enabled, no anonymous or signed-in table/function access, service-role execution, invoker security, an empty search path, and zero checkout attempts. Existing membership and billing-customer counts were unchanged. No advisor findings reference the new table/function. It was also applied twice in a temporary real PostgreSQL test database, with membership preservation, role denial, immutable receipts, expiry and risk-hold checks.

The browser checks that the signed-in session still matches the account whose billing was displayed before sending a request and before redirecting. A failed or uncertain request requires a fresh billing status check. Returning with `?business=success` does not assert that payment was received; only server billing status can confirm activation.

The provided test account signed in successfully, but server eligibility correctly identifies it as an existing company team member. Checkout is therefore blocked without changing any membership or creating a company/customer. The owner declined creating another login. Full checkout acceptance remains unverified until an eligible account is available; no eligibility bypass has been added. The source also fixes a browser-discovered CSS issue where layout rules overrode the hidden attribute on the blocked checkout form. Browser verification with the actual styles and billing script confirmed the blocked form stays hidden and eligible existing-company checkout remains visible.

Remaining before opening live checkout: an eligible-account test purchase; monthly/annual payment-to-access, cancellation, failed-payment and risk checks; approved frontend and Business/Pro candidate deployment; live webhook configuration and final production approval. No account password or secret is stored in this repository. Geofencing follows billing, per the owner's requested order.

## Known limits

- **Resubscribing.** The billing ledger pins one subscription per company. A customer whose Business subscription ended cannot buy again without manual reconciliation; checkout stops them before any payment.
- **Pro subscribers.** An account with an active Pro subscription must set it to cancel before buying Business. Its already-paid Pro period can overlap the first Business period; there is no automatic credit or refund.
- **Unlimited employees add-on.** Recognised by the webhook but not sold here yet.
- **Team members.** An account that is an employee of a company cannot buy Business; it needs a separate account.

## Checks

```
node tools/check-syntax.cjs
node --test tests/*.test.cjs
```

`tests/business-database.test.cjs` runs the SQL against a temporary local PostgreSQL with a replica of the production tables.
