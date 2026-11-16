# Campaign activation and tracking — launch checklist

November 16, 2026. Implemented and locally tested; no hosted writes or deployment.

## Inspected production

Cloudflare `profitharbor-leads-api`, active version `fed8ecfb`, service `0.6.2-email-automation-gated`. Saved source SHA256: `c1746ddc1479368af7577fe5cc5a5d23fb0b61c07042050065ba75e2362c14a6`.

Activation, production tracking and public collection environment switches are already true. The frontend loaded `ph-inline-16.js`, which offered no activation action; tracking listed only active campaigns. Inventory contained one ZEUS ONE Facebook draft and five archived campaigns, with no active campaigns. No existing campaign or link was changed. Billing code and settings were not modified.

The current owner RLS policies allow direct campaign status updates, and there is no revision trigger. This requires the proposed database guard before exposing the new activation controls.

## Implemented

The canonical wizard now loads through `lead-wizard.js` with the shared authenticated client. Verified activation refreshes and selects the campaign in tracking-link setup. Asynchronous sign-in restoration and return-to-tab refresh remain supported. Account changes clear private data and invalidate stale responses/controls. Uncertain mutations require refresh.

The Worker verifies authentication, existing Pro entitlement, owner scope, allowed state, and the campaign revision. Activation writes use the service credential with explicit owner/id/status/revision filters. The proposed trigger blocks direct client activation and creates server-controlled revision timestamps. A separate readiness switch keeps activation unavailable until the trigger is verified.

Tracking-link creation requires an active owned campaign, rate limiting, safe HTTPS destinations and a verified persisted receipt. Paused, archived, draft and unpaid campaigns cannot redirect or record clicks. Hosting a form additionally requires explicit campaign approval. The global collection switch plus internal activation cannot authorize a new public campaign.

## Verification

17 API/UI tests and one disposable PostgreSQL test pass. Syntax checks cover 42 scripts. No real user session, campaign mutation, lead submission, outgoing email, or billing mutation was used for acceptance. The database test covers direct-client activation denial, service activation, revision conflicts and preservation of existing records at installation.

Additional earlier controlled-recovery probes were compared with the inspected baseline. Both versions have the same 26 failed proposed safeguards: one submission receipt-recovery check and 25 dormant email checks. See `inherited-validation-results.json`. The email module is byte-for-byte unchanged, and live email queue/delivery switches report false. These gaps remain launch work, not newly enabled features.

## Exactly what remains

1. Review and apply `docs/campaign-activation-guard.sql` to the hosted project after rechecking policies, triggers and campaign inventory. It adds one function/trigger and updates no existing rows. Verify direct authenticated activation is denied and server revision timestamps change.
2. Recheck the active Cloudflare source fingerprint and deploy `worker/leads-api.mjs`, preserving existing bindings and secrets. Leave `PH_APPROVED_PUBLIC_CAMPAIGN_IDS` empty. Do not enable new public collection. Set `PH_CAMPAIGN_ACTIVATION_GUARD_READY=true` only after the database guard test passes; activation also requires the existing `ENABLE_PRODUCTION_CAMPAIGN_ACTIVATION=true`.
3. Publish the frontend after the new authenticated capabilities endpoint is available. Under the existing verified Pro owner, activate the exact saved ZEUS ONE draft, create one tracking link, verify the persisted owner/campaign/destination receipt, and confirm pause/archive stop activity. This hosted acceptance has not been performed.
4. Before public lead launch, fix and verify lost submission receipt recovery, then run controlled Turnstile, consent, replay/rate-limit, attribution, owner-inbox and cross-account tests. Obtain explicit approval for the exact campaign ID before placing it in `PH_APPROVED_PUBLIC_CAMPAIGN_IDS`. The existing global collection switch alone is insufficient in the candidate.
5. Keep email delivery/queue disabled until the separate email validation gaps are resolved and delivery is approved. Do not change billing or launch paid ads as part of this release.

Rollback: return to the inspected Worker/frontend versions and close the activation readiness gate. Retain campaign/link/lead history. Do not remove the database guard merely to bypass an activation failure.

Run locally: `node tools/check-syntax.cjs`, then `node --test tests/*.test.cjs`. PostgreSQL tools must be available through `PH_PG_BIN`; all database test records are created only in a temporary local cluster.
