-- Business checkout onboarding and live entitlement bridge.
--
-- 1. public.ironcrest_business_checkout: service-role-only function used by the
--    ProfitHarbor checkout Worker. It creates the buyer's Ironcrest company
--    (organization, owner membership, settings) and records the immutable
--    Stripe customer mapping that the Business billing webhook requires.
-- 2. public.ironcrest_business_entitlement: unchanged for lifetime owners and
--    the legacy subscription table; additionally grants access when the
--    Business billing webhook has recorded an active, paid LIVE subscription.
--
-- Re-runnable. Creates no tables and changes no existing rows.

begin;

create or replace function public.ironcrest_business_checkout(
  p_mode text, p_user_id uuid, p_operation text, p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_org uuid; v_name text; v_customer text; v_total integer; v_owned integer;
  v_lifetime boolean; v_review boolean := false; v_mapped text;
  s public.ironcrest_billing_snapshots%rowtype;
begin
  if current_user <> 'service_role' then raise insufficient_privilege; end if;
  if p_mode is null or p_mode not in ('test','live') or p_user_id is null
     or p_operation is null or p_operation not in ('status','prepare','customer')
     or jsonb_typeof(p_data) is distinct from 'object'
  then raise exception 'Invalid checkout operation'; end if;
  -- The Worker passes only an identity verified by Supabase Auth. The server role
  -- cannot read auth.users; foreign keys reject any unknown account on insert.

  -- One checkout operation per account at a time.
  perform pg_advisory_xact_lock(hashtextextended('ironcrest_business_checkout:' || p_user_id::text, 0));

  select count(*), count(*) filter (where m.role = 'owner' and o.created_by = p_user_id)
    into v_total, v_owned
    from public.ironcrest_memberships m
    join public.ironcrest_organizations o on o.id = m.organization_id
   where m.user_id = p_user_id and m.active;

  if v_total = 1 and v_owned = 1 then
    select m.organization_id into v_org
      from public.ironcrest_memberships m
      join public.ironcrest_organizations o on o.id = m.organization_id
     where m.user_id = p_user_id and m.active and m.role = 'owner' and o.created_by = p_user_id;
  end if;

  v_lifetime := exists (select 1 from public.owner_entitlements e
                         where e.user_id = p_user_id and e.role = 'owner' and e.lifetime_business);

  if p_operation <> 'status' then
    -- The billing webhook requires exactly one active membership: owner of
    -- the company this account created. Employees and ambiguous accounts stop here.
    if v_total > 0 and v_org is null then raise exception 'Account already belongs to a company'; end if;
    if v_org is null and exists (select 1 from public.ironcrest_organizations o where o.created_by = p_user_id)
    then raise exception 'Existing company requires review'; end if;
  end if;

  if p_operation = 'prepare' and v_org is null then
    v_name := btrim(coalesce(p_data->>'companyName', ''));
    if length(v_name) < 1 or length(v_name) > 120 or v_name ~ '[[:cntrl:]]'
    then raise exception 'Invalid company name'; end if;
    insert into public.ironcrest_organizations(name, created_by) values (v_name, p_user_id) returning id into v_org;
    insert into public.ironcrest_memberships(organization_id, user_id, role, active) values (v_org, p_user_id, 'owner', true);
    insert into public.ironcrest_company_settings(organization_id, updated_by) values (v_org, p_user_id);
    insert into public.ironcrest_settings(organization_id) values (v_org);
  end if;

  select c.customer_id, c.review_required into v_mapped, v_review
    from public.ironcrest_billing_customers c
   where c.mode = p_mode and c.owner_user_id = p_user_id;

  if p_operation = 'customer' then
    if v_org is null then raise exception 'Company required'; end if;
    v_customer := p_data->>'customerId';
    if v_customer is null or v_customer !~ '^cus_[A-Za-z0-9]+$' then raise exception 'Invalid customer'; end if;
    if v_mapped is null then
      insert into public.ironcrest_billing_customers(mode, customer_id, owner_user_id, organization_id)
        values (p_mode, v_customer, p_user_id, v_org);
      v_mapped := v_customer; v_review := false;
    elsif v_mapped <> v_customer then
      raise exception 'Billing customer already mapped';
    end if;
  end if;

  if v_mapped is not null then
    select * into s from public.ironcrest_billing_snapshots b
     where b.mode = p_mode and b.customer_id = v_mapped and b.subscription_type = 'business';
  end if;

  return jsonb_build_object(
    'mode', p_mode,
    'hasCompany', v_org is not null,
    'organizationId', v_org,
    'eligible', v_org is not null or (v_total = 0 and not exists (
        select 1 from public.ironcrest_organizations o where o.created_by = p_user_id)),
    'lifetimeBusiness', v_lifetime and v_org is not null,
    'customerId', v_mapped,
    'reviewRequired', coalesce(v_review, false),
    'subscriptionStatus', s.status,
    'subscriptionActive', coalesce(v_org is not null and not coalesce(v_review, false) and s.business_active
        and s.status = 'active' and s.current_period_end > now(), false),
    'employeeLimit', s.employee_limit,
    'currentPeriodEnd', s.current_period_end,
    'cancelAtPeriodEnd', coalesce(s.cancel_at_period_end, false));
end;
$function$;

revoke all on function public.ironcrest_business_checkout(text, uuid, text, jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.ironcrest_business_checkout(text, uuid, text, jsonb) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.ironcrest_business_checkout(text, uuid, text, jsonb) from authenticated; end if;
end $$;
grant execute on function public.ironcrest_business_checkout(text, uuid, text, jsonb) to service_role;

-- Same result shape and identical results for lifetime and legacy subscription
-- access. Adds: an active LIVE Business billing snapshot for this company.
create or replace function public.ironcrest_business_entitlement(p_organization_id uuid)
returns table(business_active boolean, unlimited_employees boolean, employee_limit integer, entitlement_status text)
language sql
stable
set search_path to ''
as $function$
  with entitlement_check as (
    select
      exists (
        select 1
          from public.ironcrest_organizations o
          join public.owner_entitlements e on e.user_id = o.created_by
         where o.id = p_organization_id and e.role = 'owner' and e.lifetime_business = true
      ) as has_lifetime_business,
      exists (
        select 1
          from public.ironcrest_organizations o
          join public.ph_subscriptions_live s on s.user_id = o.created_by
          join public.ironcrest_stripe_price_mapping p on p.stripe_price_id = s.stripe_price_id
         where o.id = p_organization_id and p.entitlement = 'business'
           and s.status = 'active' and s.current_period_end > now()
      ) as has_paid_business,
      exists (
        select 1
          from public.ironcrest_addon_subscriptions a
          join public.ironcrest_stripe_price_mapping p on p.stripe_price_id = a.stripe_price_id
         where a.organization_id = p_organization_id and p.entitlement = 'unlimited_employees'
           and a.status = 'active' and a.current_period_end > now()
      ) as has_unlimited_addon
  ), billing as (
    -- Mirrors ironcrest_webhook_business_entitlement for mode 'live'.
    select s.employee_limit as base_limit,
           (s.unlimited_employees or coalesce(a.unlimited_employees and a.status = 'active'
              and a.current_period_end > now(), false)) as unlimited
      from public.ironcrest_billing_customers c
      join public.ironcrest_billing_snapshots s
        on s.mode = c.mode and s.customer_id = c.customer_id and s.subscription_type = 'business'
      left join public.ironcrest_billing_snapshots a
        on a.mode = c.mode and a.customer_id = c.customer_id and a.subscription_type = 'unlimited_employees'
     where c.mode = 'live' and c.organization_id = p_organization_id and not c.review_required
       and s.business_active and s.status = 'active' and s.current_period_end > now()
       and exists (
         select 1 from public.ironcrest_organizations o
           join public.ironcrest_memberships m
             on m.organization_id = o.id and m.user_id = o.created_by and m.role = 'owner' and m.active
          where o.id = c.organization_id and o.created_by = c.owner_user_id)
       and (select count(*) from public.ironcrest_memberships m2
             where m2.user_id = c.owner_user_id and m2.active) = 1
  ), flags as (
    select e.*, (has_lifetime_business or has_paid_business) as legacy,
           exists (select 1 from billing) as has_billing,
           coalesce((select unlimited from billing), false) as billing_unlimited,
           (select base_limit from billing) as billing_limit
      from entitlement_check e
  )
  select
    (legacy or has_billing),
    ((legacy and has_unlimited_addon) or (has_billing and billing_unlimited)),
    case
      when legacy then (case when has_unlimited_addon then null else 20 end)
      when has_billing then (case when billing_unlimited then null else billing_limit end)
      else 0
    end,
    case
      when has_lifetime_business then 'LIFETIME_BUSINESS'
      when has_paid_business then (case when has_unlimited_addon then 'BUSINESS_UNLIMITED' else 'BUSINESS_20' end)
      when has_billing then (case when billing_unlimited then 'BUSINESS_UNLIMITED' else 'BUSINESS_20' end)
      else 'NO_BUSINESS_ACCESS'
    end
  from flags;
$function$;

commit;
