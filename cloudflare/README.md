# ProfitHarbor leads Worker deployment readiness

Target Worker: `profitharbor-leads-api`.

## Safety status

- Cloudflare API token is stored as GitHub Actions secret `CLOUDFLARE_API_TOKEN` (reported by repository owner; connector cannot read secrets).
- **No deployment workflow is enabled in this branch.**
- Current Worker source was exported from Cloudflare's editor as compiled `worker.js` and is pending source-controlled import.
- Before any deployment, retrieve and review the existing Worker configuration, including the Durable Object binding `PH_ATOMIC_GUARD`, its class `ProfitHarborAtomicGuard`, migrations, compatibility settings, routes, triggers, and environment bindings.
- Keep existing Supabase and Resend credentials in Cloudflare secrets; never commit them.
- Keep `ENABLE_EMAIL_QUEUE`, `ENABLE_EMAIL_AUTOMATION`, and `ENABLE_EMAIL_DELIVERY` disabled until explicitly approved after safe tests.
- Production deployment must be manual, restricted to the main branch, gated by a GitHub production environment with required reviewer approval, and followed by a health check.
- Back up the current deployment and confirm a rollback procedure before the first release.
- The deployment token can update Worker scripts; treat it as sensitive even with GitHub environment protection.

This file documents readiness only. It does not deploy, schedule, or alter production services.
