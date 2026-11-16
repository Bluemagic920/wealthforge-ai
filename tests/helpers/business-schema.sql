-- Minimal replica of the production objects that docs/business-checkout.sql touches.
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users(id uuid primary key);
create table public.ironcrest_organizations(id uuid primary key default gen_random_uuid(), name text not null check (length(trim(both from name)) > 0), created_by uuid not null references auth.users(id), created_at timestamptz not null default now());
create table public.ironcrest_memberships(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.ironcrest_organizations(id) on delete cascade, user_id uuid not null references auth.users(id), role text not null default 'employee' check (role in ('owner','manager','employee')), active boolean not null default true, created_at timestamptz not null default now(), unique (organization_id, user_id));
create table public.ironcrest_company_settings(organization_id uuid primary key references public.ironcrest_organizations(id), time_zone text not null default 'UTC', week_starts_on smallint not null default 1, revision bigint not null default 1, updated_at timestamptz not null default now(), updated_by uuid not null references auth.users(id));
create table public.ironcrest_settings(organization_id uuid primary key references public.ironcrest_organizations(id) on delete cascade, time_tracking_enabled boolean not null default false, job_tracking_enabled boolean not null default false, scheduling_enabled boolean not null default false, updated_at timestamptz not null default now());
create table public.owner_entitlements(user_id uuid not null, role text not null default 'owner', lifetime_pro boolean not null default true, created_at timestamptz not null default now(), lifetime_business boolean not null default false);
create table public.ph_subscriptions_live(user_id uuid not null, stripe_customer_id text, stripe_subscription_id text, stripe_price_id text, status text not null default 'inactive', current_period_end timestamptz, cancel_at_period_end boolean not null default false, updated_at timestamptz not null default now());
create table public.ironcrest_stripe_price_mapping(stripe_price_id text primary key, entitlement text not null check (entitlement in ('business','unlimited_employees')), created_at timestamptz not null default now());
create table public.ironcrest_addon_subscriptions(id uuid primary key default gen_random_uuid(), organization_id uuid not null, stripe_subscription_id text not null, stripe_price_id text not null, status text not null, current_period_end timestamptz, cancel_at_period_end boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.ironcrest_billing_customers(mode text not null check (mode in ('test','live')), customer_id text not null check (customer_id ~ '^cus_[A-Za-z0-9]+$'), owner_user_id uuid not null references auth.users(id), organization_id uuid not null references public.ironcrest_organizations(id), subscription_id text, unlimited_subscription_id text, lease_token uuid, lease_until timestamptz, review_required boolean not null default false, primary key (mode, customer_id), unique (mode, owner_user_id), unique (mode, organization_id));
create table public.ironcrest_billing_snapshots(mode text not null, customer_id text not null, subscription_id text not null, subscription_type text not null check (subscription_type in ('business','unlimited_employees')), status text not null, business_active boolean not null, unlimited_employees boolean not null, employee_limit integer not null check (employee_limit between 0 and 100000), current_period_end timestamptz not null, cancel_at_period_end boolean not null, updated_at timestamptz not null default clock_timestamp(), primary key (mode, customer_id, subscription_type), foreign key (mode, customer_id) references public.ironcrest_billing_customers(mode, customer_id));
-- As in production, service_role has no direct access to auth.users.
grant all on all tables in schema public to service_role;
grant select on all tables in schema public to authenticated;
-- Production definition before this change, kept to prove existing results are preserved.
create function public.ironcrest_business_entitlement(p_organization_id uuid)
returns table(business_active boolean, unlimited_employees boolean, employee_limit integer, entitlement_status text)
language sql stable set search_path to '' as $f$
  with entitlement_check as (
    select
      exists (select 1 from public.ironcrest_organizations o join public.owner_entitlements e on e.user_id = o.created_by
               where o.id = p_organization_id and e.role = 'owner' and e.lifetime_business = true) as has_lifetime_business,
      exists (select 1 from public.ironcrest_organizations o join public.ph_subscriptions_live s on s.user_id = o.created_by
               join public.ironcrest_stripe_price_mapping p on p.stripe_price_id = s.stripe_price_id
               where o.id = p_organization_id and p.entitlement = 'business' and s.status = 'active' and s.current_period_end > now()) as has_paid_business,
      exists (select 1 from public.ironcrest_addon_subscriptions a join public.ironcrest_stripe_price_mapping p on p.stripe_price_id = a.stripe_price_id
               where a.organization_id = p_organization_id and p.entitlement = 'unlimited_employees' and a.status = 'active' and a.current_period_end > now()) as has_unlimited_addon)
  select (has_lifetime_business or has_paid_business),
         ((has_lifetime_business or has_paid_business) and has_unlimited_addon),
         case when not (has_lifetime_business or has_paid_business) then 0 when has_unlimited_addon then null else 20 end,
         case when has_lifetime_business then 'LIFETIME_BUSINESS' when not has_paid_business then 'NO_BUSINESS_ACCESS'
              when has_unlimited_addon then 'BUSINESS_UNLIMITED' else 'BUSINESS_20' end
  from entitlement_check;
$f$;
revoke all on function public.ironcrest_business_entitlement(uuid) from public;
grant execute on function public.ironcrest_business_entitlement(uuid) to service_role;
