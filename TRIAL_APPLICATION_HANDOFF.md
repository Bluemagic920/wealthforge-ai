# Qualified small-business Pro trial application

## Request and scope
Chris requested a homepage 30-day free trial offer aimed at serious small-business owners, with feedback after the trial. This branch prepares the qualification and application UI only, using the existing sales-inquiry intake. It does not implement or advertise instant enrollment. Existing policy: initial campaign up to 10 approved Pro memberships, 30 days from successful activation, no credit card, normal Pro limits, and no automatic billing. Business/Ironcrest remain excluded. Prior Ironcrest-first ordering still applies to activating this campaign; the homepage can collect applications once reviewed and deployed.

## Changes
- Homepage navy/teal/gold offer before public pricing; collapsible qualification form.
- Required name, email, business name, role (owner/co-owner or authorized purchase decision-maker), industry, team size, substantive trial goal, possible purchase timing, active-business confirmation, pricing awareness and application-contact permission.
- Optional business website/public profile; personal email addresses remain accepted for sole proprietors.
- Optional end-of-trial feedback email permission, unchecked by default and separate from marketing.
- Prepare action populates existing sales inquiry without network calls. Applicant reviews details, completes existing Turnstile verification and explicitly submits through the existing client. Existing intake service availability and production behavior were not verified. The new client never grants membership, creates subscriptions or stores applicant details in localStorage.
- Existing marketing consent is cleared on handoff. Trial/feedback choices are serialized into the inquiry message using PRO_TRIAL_APPLICATION_V1. They are human-review metadata, not an authoritative consent ledger or automated entitlement record. No application was sent during testing.

## Review and future activation
An application is not proof of ownership or purchase intent. Owner review should verify an active business using public business evidence or a business-specific follow-up, assess the stated workflow, and check existing accounts/trial history. Do not reject a legitimate proprietor solely for using a personal email or lacking a website. Reject/hold duplicates, obvious non-business uses and unclear authority. Do not collect government ID, payment details, tax IDs or other unnecessary sensitive evidence.

Before working trials go live, implement verified-email, recipient-bound, single-use invitations; a server-side atomic 10-activation cap and per-business duplicate/replay controls; immutable activation and 30-day expiry; Pro access enforcement across AI and data limits; preservation of existing paid/lifetime entitlements; normal approved retention/export policy. Do not grant access by DOM state, browser storage, inquiry text, client timestamps or a caller-supplied role. No trial system is live from this patch.

## Feedback follow-up
After the actual activation timestamp +30 days, offer a short optional feedback form. A transactional feedback email may be sent only if the separately recorded feedback consent is true and remains valid. Do not make feedback or marketing mandatory to receive a trial. Use a server-owned one-time schedule/delivery key per trial, verified recipient binding, and suppression/withdrawal checks; do not send early based on application date. Email sending gates remain disabled. No scheduler or email sending was added here.

Suggested feedback questions:
1. What did you use ProfitHarbor AI for during the trial?
2. What worked well, and what was confusing or missing?
3. Did it save you time or help you manage customers? Please describe.
4. Would you choose Pro at $29.99/month? Yes / Maybe / No, with optional reason.
5. May we contact you about your feedback? Optional.
Any public testimonial requires separate explicit permission; do not treat feedback consent as testimonial consent.

## Verification
Seven Node tests passed for qualification, field bounds, optional feedback permission, personal-email/no-site acceptance, URL validation, message size, and no access/marketing grants. Desktop browser preview (all unrelated scripts and network submission removed from preview only) confirmed the collapsed offer, required fields, successful handoff, no submission, feedback YES serialization and unchecked marketing. Existing authenticated app scripts and billing were left unchanged in production source. No real customer data, email, live deployment, database, billing or entitlement changes occurred.

## Source and delivery
Base: Bluemagic920/wealthforge-ai main index.html blob 6565307745289e0ed262db90356073b659c4065c. Isolated branch feature/qualified-pro-trial-applications; do not merge/deploy over a later homepage without reviewing the diff. Public homepage could not be read through the web lookup tool, so repository source is the verified baseline, not proof of current deployment. Full production scripts/security widget and live intake remain integration validation. This does not modify the hourly email-reliability workstream.
