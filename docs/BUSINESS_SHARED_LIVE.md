# Business on the existing live billing service

The owner approved the live Business rollout on November 21, 2026. Use the existing `profitharbor-ai-live-api` Worker and its configured `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET_LIVE`, and `SUPABASE_SERVICE_ROLE_KEY`. The integration references those values inside the same Worker; it never reveals, copies, rotates or transmits a secret to another service. No new keys or account login are required.

Build the approved artifact:

```
node tools/build-business-shared-live.cjs <output-path> --production-approved
```

The builder retains the inspected Pro service and verified Business-to-Pro access change. It embeds the reviewed Ironcrest webhook bundle from Ironcrest main `0c95f2c`, SHA-256 `279413a7f698173871f2fc83f2b14738eac33984ee6fb2cdf75672f314015ef2`. The vendored module is deliberately pinned; re-review an upstream update before changing the hash.

Business status, checkout and portal routes use the existing live credentials. Authenticated status verifies the correct live account, monthly price and annual price without a purchase. Checkout still requires its independent source approval, webhook readiness, reservation readiness and open-checkout settings.

The existing Stripe endpoint `profitharbor-ai-live-api/.../api/stripe-webhook` retains its URL and signing secret. The original Pro handler runs first, preserving its authentication, storage and retry behavior. Only an explicitly ignored event reaches the Business handler. A Business failure returns a retryable response; a processed Pro event is never written to Business storage. Add the Business event types to the existing endpoint's event list, preserving its existing events and API version.

`profitharbor-business-api` becomes a compatibility proxy. It has no credential dependency and forwards only the existing Business routes to the fixed live-service hostname. It forwards authorization, origin and content type, and drops cookies and caller-supplied Host headers. Existing frontend URLs remain unchanged.

The separately prepared `profitharbor-business-billing` Worker and new endpoint remain closed/disabled and are unused by this integration. Do not request keys for them.

Settings on `profitharbor-ai-live-api`: `ENABLE_BUSINESS_INTEGRATION=true`, `BUSINESS_PRO_ACCESS_READY=true`, `ENABLE_BUSINESS_BILLING=true`, `BUSINESS_CHECKOUT_ATTEMPTS_READY=true`. Keep `ENABLE_BUSINESS_CHECKOUT=false` until live status, catalog and signed delivery checks pass; then set `BUSINESS_WEBHOOK_READY=true` and open checkout under the existing owner approval.

Existing paid monthly and annual Stripe test invoices and committed webhook/cancellation records were verified. The owner declined another login and accepted that previous purchase evidence. New regression checks exercise the built shared runtime, checkout, signed Pro/Business isolation, duplicates, signature rejection, retry behavior, source gates, fixed-host proxying and header filtering. Existing memberships and billing records are preserved.

Rollback: close `ENABLE_BUSINESS_CHECKOUT` and disable `ENABLE_BUSINESS_INTEGRATION` to restore original Pro routing. Retain all billing mappings, journals and snapshots.
