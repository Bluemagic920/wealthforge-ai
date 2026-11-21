-- Review and approval required before applying to the hosted database.
-- Serializes Checkout across intervals, browsers, origins and Worker instances.
-- An uncertain Stripe response never releases the reservation for another charge.
begin;
create table if not exists public.ironcrest_business_checkout_attempts (
  mode text not null check (mode in ('test','live')),
  owner_user_id uuid not null,
  customer_id text not null,
  organization_id uuid not null,
  attempt_id uuid not null default gen_random_uuid(),
  billing_interval text not null check (billing_interval in ('month','year')),
  origin text not null check (origin in ('https://profitharborai.com','https://www.profitharborai.com')),
  expires_at bigint not null default (extract(epoch from clock_timestamp())::bigint + 3600),
  session_id text,
  primary key (mode,owner_user_id),
  unique (attempt_id),
  foreign key (mode,customer_id) references public.ironcrest_billing_customers(mode,customer_id)
);
alter table public.ironcrest_business_checkout_attempts enable row level security;
revoke all on public.ironcrest_business_checkout_attempts from public,anon,authenticated;
grant select,insert,update on public.ironcrest_business_checkout_attempts to service_role;
drop policy if exists business_checkout_service on public.ironcrest_business_checkout_attempts;
create policy business_checkout_service on public.ironcrest_business_checkout_attempts to service_role using (true) with check (true);

create or replace function public.ironcrest_business_checkout_attempt(
  p_mode text,p_user_id uuid,p_operation text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql set search_path to '' as $f$
declare
  s jsonb; a public.ironcrest_business_checkout_attempts%rowtype;
begin
  if current_user <> 'service_role' then raise insufficient_privilege; end if;
  if p_mode is null or p_mode not in ('test','live') or p_user_id is null
    or p_operation is null or p_operation not in ('reserve','record','expired')
    or jsonb_typeof(p_data) is distinct from 'object'
  then raise exception 'Invalid checkout attempt'; end if;
  -- Same lock as onboarding: mapping and ownership must still be valid.
  perform pg_advisory_xact_lock(hashtextextended('ironcrest_business_checkout:'||p_user_id::text,0));
  s := public.ironcrest_business_checkout(p_mode,p_user_id,'status','{}');
  if not coalesce((s->>'eligible')::boolean,false) or s->>'organizationId' is null
    or s->>'customerId' is null or coalesce((s->>'reviewRequired')::boolean,true)
    or coalesce((s->>'lifetimeBusiness')::boolean,false)
    or s->>'subscriptionStatus' is not null
  then raise exception 'Checkout state changed'; end if;
  select * into a from public.ironcrest_business_checkout_attempts where mode=p_mode and owner_user_id=p_user_id for update;
  if found and (a.customer_id <> s->>'customerId' or a.organization_id <> (s->>'organizationId')::uuid)
  then raise exception 'Checkout mapping changed'; end if;
  if p_operation='reserve' then
    if a.attempt_id is null then
      insert into public.ironcrest_business_checkout_attempts(mode,owner_user_id,customer_id,organization_id,billing_interval,origin)
      values(p_mode,p_user_id,s->>'customerId',(s->>'organizationId')::uuid,p_data->>'interval',p_data->>'origin') returning * into a;
    end if;
  else
    if a.attempt_id is null or a.attempt_id::text is distinct from p_data->>'attemptId'
      or p_data->>'sessionId' is null or p_data->>'sessionId' !~ '^cs_[A-Za-z0-9_]+$'
    then raise exception 'Checkout receipt mismatch'; end if;
    if p_operation='record' then
      if a.session_id is not null and a.session_id <> p_data->>'sessionId' then raise exception 'Checkout receipt mismatch'; end if;
      update public.ironcrest_business_checkout_attempts set session_id=p_data->>'sessionId'
        where mode=p_mode and owner_user_id=p_user_id returning * into a;
    else
      -- Worker must retrieve and verify this exact session's expired status first.
      if a.session_id is distinct from p_data->>'sessionId' then raise exception 'Checkout receipt mismatch'; end if;
      update public.ironcrest_business_checkout_attempts set attempt_id=gen_random_uuid(),session_id=null,
        expires_at=extract(epoch from clock_timestamp())::bigint+3600,
        billing_interval=p_data->>'interval',origin=p_data->>'origin'
        where mode=p_mode and owner_user_id=p_user_id returning * into a;
    end if;
  end if;
  return jsonb_build_object('attemptId',a.attempt_id,'interval',a.billing_interval,'origin',a.origin,
    'expiresAt',a.expires_at,'sessionId',a.session_id,'customerId',a.customer_id,'organizationId',a.organization_id);
end $f$;
revoke all on function public.ironcrest_business_checkout_attempt(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ironcrest_business_checkout_attempt(text,uuid,text,jsonb) to service_role;
commit;
