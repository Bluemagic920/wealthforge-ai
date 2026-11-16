# Business membership launch

Business ($129.99 a month or $1,325.90 a year, 20 employees) is bought on profitharborai.com and unlocks Ironcrest Workforce Operations.

## How it works

1. A signed-in ProfitHarbor account chooses Business under Account.
2. `worker/business-api.mjs` (Worker `profitharbor-business-api`) creates the buyer's Ironcrest company, maps a Stripe customer to it, and returns a Stripe Checkout link.
3. Stripe sends subscription events to the Business billing webhook, which records the paid subscription in `ironcrest_billing_snapshots`.
4. `ironcrest_business_entitlement` (updated by `docs/business-checkout.sql`) grants Ironcrest access while a live subscription is active and paid.

The site keeps its "Coming Soon" wording until the Business API reports live checkout open, so this change is safe to publish before anything else is deployed.

## Go-live steps

1. **Database.** Apply `docs/business-checkout.sql` to the Supabase project. It adds one function and replaces `ironcrest_business_entitlement`; results for lifetime owners and the legacy subscription table are unchanged. It creates no tables and changes no rows.
2. **Business API Worker.** Create a Worker named `profitharbor-business-api` from `worker/business-api.mjs`. The site calls `https://profitharbor-business-api.bluemagic920.workers.dev`; if the name differs, update `API` in `ph-business.js`. Settings:
   - `BUSINESS_STRIPE_MODE`: `test` first, later `live`
   - `BUSINESS_STRIPE_KEY` (secret): Stripe key for that mode
   - `SUPABASE_SERVICE_ROLE_KEY` (secret)
   - `ENABLE_BUSINESS_CHECKOUT`: `true`
3. **Test-mode run.** With the Worker in `test` mode, sign in on the site, open Account, and buy Business with a Stripe test card. The staging Worker's Business webhook already records test events. Expected: the panel shows "TEST MODE" and "Your Business membership is active". Test payments never unlock the live Ironcrest workspace.
4. **Production webhook.** Deploy the Business billing webhook for live mode (`productionApproved: true`, `BUSINESS_STRIPE_MODE=live`, live key, live webhook secret, `ENABLE_BUSINESS_BILLING=true`) and register its `/api/business/billing/webhook` URL in Stripe live mode. This is not part of this change.
5. **Pro features for Business.** `profitharbor-ai-live-api` grants Pro features (AI Assistant, unlimited customers) only to the Pro price. Until it also accepts an active Business membership, Business buyers do not get those. This is not part of this change.
6. **Switch to live.** Set `BUSINESS_STRIPE_MODE=live` and the live key on `profitharbor-business-api`. The site then shows "Choose Business".

## Known limits

- **Resubscribing.** The billing ledger pins one subscription per company. A customer whose Business subscription ended cannot buy again without manual reconciliation; checkout stops them before any payment.
- **Pro subscribers.** An account with an active Pro subscription must set it to cancel before buying Business, so it is never billed for both.
- **Unlimited employees add-on.** Recognised by the webhook but not sold here yet.
- **Team members.** An account that is an employee of a company cannot buy Business; it needs a separate account.

## Checks

```
node tools/check-syntax.cjs
node --test tests/*.test.cjs
```

`tests/business-database.test.cjs` runs the SQL against a temporary local PostgreSQL with a replica of the production tables.
