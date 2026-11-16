-- Review proposal: apply only after checking existing table policies and triggers.
-- No campaign row or billing record is modified by this migration.
begin;
create function public.ph_guard_campaign_activation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.updated_at:=clock_timestamp();
 if new.status='active' and (tg_op='INSERT' or old.status is distinct from 'active')
  and current_user<>'service_role' then
  raise insufficient_privilege using message='Campaign activation requires the verified Leads API';
 end if;
 return new;
end;
$$;
revoke all on function public.ph_guard_campaign_activation() from public,anon,authenticated;
grant execute on function public.ph_guard_campaign_activation() to service_role;
create trigger ph_campaign_activation_guard before insert or update on public.ph_lead_campaigns
for each row execute function public.ph_guard_campaign_activation();
commit;
