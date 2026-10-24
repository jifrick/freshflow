-- MVP integrity hardening for the existing FreshFlow schema.
-- Migration history requires reconciliation before deployment: remote records
-- inventory_photo_storage as 20261023210157, while the tracked local filename is
-- 20261024000100_inventory_photo_storage.sql. Do not replay or repair either entry
-- until their deployed objects and SQL equivalence have been verified.

alter table public.inventory_batches
  add column if not exists harvested_or_purchased_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists moderation_status text not null default 'draft'
    check (moderation_status in ('draft', 'pending_review', 'approved', 'rejected')),
  add column if not exists moderation_submitted_at timestamptz;

update public.inventory_batches set moderation_status = 'approved'
where is_published and moderation_status <> 'approved';

create unique index if not exists inventory_batches_id_owner_uidx
  on public.inventory_batches(id, owner_id);

create table if not exists public.inventory_private_costs (
  batch_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  purchase_cost numeric(14,2) not null check (purchase_cost >= 0),
  updated_at timestamptz not null default now(),
  constraint inventory_private_costs_batch_owner_fk
    foreign key (batch_id, owner_id)
    references public.inventory_batches(id, owner_id) on delete cascade
);

insert into public.inventory_private_costs(batch_id, owner_id, purchase_cost)
select id, owner_id, purchase_cost
from public.inventory_batches
where purchase_cost is not null
on conflict (batch_id) do nothing;

alter table public.inventory_private_costs enable row level security;
create policy "Owners read private inventory costs" on public.inventory_private_costs
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners create private inventory costs" on public.inventory_private_costs
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners update private inventory costs" on public.inventory_private_costs
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners delete private inventory costs" on public.inventory_private_costs
  for delete to authenticated using ((select auth.uid()) = owner_id);
grant select on public.inventory_private_costs to authenticated;
grant insert (batch_id, owner_id, purchase_cost) on public.inventory_private_costs to authenticated;
grant update (purchase_cost) on public.inventory_private_costs to authenticated;
grant delete on public.inventory_private_costs to authenticated;
revoke all on public.inventory_private_costs from anon, public;

-- Remove table-wide SELECT and grant only non-sensitive listing columns.
-- The owner-only purchase_cost remains in the legacy column for rollback and is
-- copied to the RLS-protected table above; the Data API cannot select that column.
revoke all on table public.inventory_batches from public, anon;
revoke select on table public.inventory_batches from authenticated;
revoke truncate, references, trigger on table public.inventory_batches
  from public, anon, authenticated;
-- Explicitly document and remove any direct legacy access or writes to this column.
revoke select (purchase_cost), insert (purchase_cost), update (purchase_cost), references (purchase_cost)
  on table public.inventory_batches from public, anon, authenticated;
grant select (
  id, owner_id, produce, quantity, available_quantity, reserved_quantity,
  sold_quantity, unit, location, quality, asking_price, available_at,
  freshness_hours, status, is_published, created_at, updated_at, photo_path,
  harvested_or_purchased_at, archived_at
) on public.inventory_batches to authenticated;

create or replace view public.inventory_listings
with (security_invoker = true)
as
select id, owner_id, produce, quantity, available_quantity, reserved_quantity,
       sold_quantity, unit, location, quality, asking_price, available_at,
       freshness_hours, status, is_published, created_at, updated_at, photo_path,
       harvested_or_purchased_at, archived_at
from public.inventory_batches;
grant select on public.inventory_listings to authenticated;
revoke all on public.inventory_listings from anon, public;

alter table public.offers
  add column if not exists known_costs jsonb not null default '{}'::jsonb,
  add column if not exists countered_by uuid references auth.users(id) on delete restrict,
  add column if not exists last_action_at timestamptz not null default now();

create table if not exists public.offer_events (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('submitted', 'countered', 'accepted', 'rejected', 'cancelled', 'seller_reported_handover', 'buyer_confirmed_handover')),
  quantity numeric(14,3),
  unit_price numeric(14,2),
  created_at timestamptz not null default now()
);
create index if not exists offer_events_offer_created_idx on public.offer_events(offer_id, created_at);
alter table public.offer_events enable row level security;
create policy "Offer participants read offer history" on public.offer_events
  for select to authenticated using (
    exists (select 1 from public.offers o where o.id = offer_id
      and (select auth.uid()) in (o.seller_id, o.buyer_id))
  );
grant select on public.offer_events to authenticated;
revoke all on public.offer_events from anon, public;

alter table public.outcomes
  add column if not exists verification_status text not null default 'seller_reported'
    check (verification_status in ('seller_reported', 'buyer_confirmed')),
  add column if not exists buyer_confirmed_by uuid references auth.users(id) on delete restrict,
  add column if not exists buyer_confirmed_at timestamptz;

create or replace function private.create_inventory_batch(
  p_produce text, p_quantity numeric, p_unit text, p_location text, p_quality text,
  p_asking_price numeric, p_purchase_cost numeric, p_available_at timestamptz,
  p_harvested_or_purchased_at timestamptz, p_freshness_hours integer, p_is_published boolean
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_produce is null or length(trim(p_produce)) not between 1 and 100
     or p_quantity is null or p_quantity <= 0
     or p_unit is null or p_unit not in ('kg', 'crate', 'box')
     or p_location is null or length(trim(p_location)) = 0
     or p_quality is null or p_quality not in ('Premium', 'Good', 'Needs sorting')
     or (p_asking_price is not null and p_asking_price < 0)
     or (p_purchase_cost is not null and p_purchase_cost < 0)
     or (p_freshness_hours is not null and p_freshness_hours <= 0)
     or p_available_at is null then raise exception 'Inventory values are invalid'; end if;
  insert into public.inventory_batches(owner_id, produce, quantity, available_quantity, unit,
    location, quality, asking_price, available_at, freshness_hours,
    harvested_or_purchased_at, is_published, moderation_status, moderation_submitted_at)
  values ((select auth.uid()), trim(p_produce), p_quantity, p_quantity, p_unit,
    trim(p_location), p_quality, p_asking_price, p_available_at, p_freshness_hours,
    p_harvested_or_purchased_at, false,
    case when coalesce(p_is_published, false) then 'pending_review' else 'draft' end,
    case when coalesce(p_is_published, false) then now() else null end)
  returning id into v_id;
  if p_purchase_cost is not null then
    insert into public.inventory_private_costs(batch_id, owner_id, purchase_cost)
    values (v_id, (select auth.uid()), p_purchase_cost);
  end if;
  return v_id;
end;
$$;
revoke all on function private.create_inventory_batch(text, numeric, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, boolean) from public, anon;
grant execute on function private.create_inventory_batch(text, numeric, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, boolean) to authenticated;

create or replace function public.create_inventory_batch(
  p_produce text, p_quantity numeric, p_unit text, p_location text, p_quality text,
  p_asking_price numeric, p_purchase_cost numeric, p_available_at timestamptz,
  p_harvested_or_purchased_at timestamptz, p_freshness_hours integer, p_is_published boolean
) returns uuid language sql security invoker set search_path = ''
as $$ select private.create_inventory_batch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11); $$;
revoke all on function public.create_inventory_batch(text, numeric, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, boolean) from public, anon;
grant execute on function public.create_inventory_batch(text, numeric, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, boolean) to authenticated;

create or replace function private.update_inventory_batch(
  p_batch_id uuid, p_produce text, p_quantity numeric, p_unit text, p_location text,
  p_quality text, p_asking_price numeric, p_purchase_cost numeric, p_available_at timestamptz,
  p_harvested_or_purchased_at timestamptz, p_freshness_hours integer, p_is_published boolean
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_batch public.inventory_batches%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_produce is null or length(trim(p_produce)) not between 1 and 100
     or p_quantity is null or p_quantity <= 0 or p_unit not in ('kg', 'crate', 'box')
     or p_location is null or length(trim(p_location)) = 0
     or p_quality is null or p_quality not in ('Premium', 'Good', 'Needs sorting')
     or (p_asking_price is not null and p_asking_price < 0)
     or (p_purchase_cost is not null and p_purchase_cost < 0)
     or (p_freshness_hours is not null and p_freshness_hours <= 0)
     or p_available_at is null then raise exception 'Inventory values are invalid'; end if;
  select * into v_batch from public.inventory_batches
  where id = p_batch_id and owner_id = (select auth.uid()) and archived_at is null for update;
  if not found then raise exception 'Inventory batch is unavailable or not owned by this user'; end if;
  if v_batch.reserved_quantity <> 0 or v_batch.sold_quantity <> 0
     or exists (select 1 from public.offers o where o.inventory_id = v_batch.id and o.status = 'pending')
    then raise exception 'Inventory with reserved, sold, or pending-offer quantities cannot be edited'; end if;
  update public.inventory_batches set produce = trim(p_produce), quantity = p_quantity,
    available_quantity = p_quantity, unit = p_unit, location = trim(p_location), quality = p_quality,
    asking_price = p_asking_price, available_at = p_available_at,
    harvested_or_purchased_at = p_harvested_or_purchased_at,
    freshness_hours = p_freshness_hours, is_published = false,
    moderation_status = case when coalesce(p_is_published, false) then 'pending_review' else 'draft' end,
    moderation_submitted_at = case when coalesce(p_is_published, false) then now() else null end,
    updated_at = now()
  where id = v_batch.id;
  if p_purchase_cost is null then
    delete from public.inventory_private_costs where batch_id = v_batch.id and owner_id = (select auth.uid());
  else
    insert into public.inventory_private_costs(batch_id, owner_id, purchase_cost)
    values (v_batch.id, (select auth.uid()), p_purchase_cost)
    on conflict (batch_id) do update set purchase_cost = excluded.purchase_cost, updated_at = now();
  end if;
end;
$$;
revoke all on function private.update_inventory_batch(uuid, text, numeric, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, boolean) from public, anon;
grant execute on function private.update_inventory_batch(uuid, text, numeric, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, boolean) to authenticated;
create or replace function public.update_inventory_batch(
  p_batch_id uuid, p_produce text, p_quantity numeric, p_unit text, p_location text,
  p_quality text, p_asking_price numeric, p_purchase_cost numeric, p_available_at timestamptz,
  p_harvested_or_purchased_at timestamptz, p_freshness_hours integer, p_is_published boolean
) returns void language sql security invoker set search_path = ''
as $$ select private.update_inventory_batch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12); $$;
revoke all on function public.update_inventory_batch(uuid, text, numeric, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, boolean) from public, anon;
grant execute on function public.update_inventory_batch(uuid, text, numeric, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, boolean) to authenticated;

create or replace function private.archive_inventory_batch(p_batch_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_batch public.inventory_batches%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into v_batch from public.inventory_batches where id = p_batch_id
    and owner_id = (select auth.uid()) and archived_at is null for update;
  if not found then raise exception 'Inventory batch is unavailable or not owned by this user'; end if;
  if v_batch.reserved_quantity <> 0 or exists (
    select 1 from public.offers o where o.inventory_id = v_batch.id and o.status = 'pending'
  ) then raise exception 'Resolve reservations and pending offers before archiving'; end if;
  update public.inventory_batches set archived_at = now(), is_published = false,
    status = 'unavailable', updated_at = now() where id = v_batch.id;
end;
$$;
revoke all on function private.archive_inventory_batch(uuid) from public, anon;
grant execute on function private.archive_inventory_batch(uuid) to authenticated;
create or replace function public.archive_inventory_batch(p_batch_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.archive_inventory_batch($1); $$;
revoke all on function public.archive_inventory_batch(uuid) from public, anon;
grant execute on function public.archive_inventory_batch(uuid) to authenticated;

create or replace function private.update_buyer_demand(
  p_demand_id uuid, p_produce text, p_quantity numeric, p_unit text, p_max_price numeric,
  p_location text, p_required_by timestamptz, p_quality text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_demand public.buyer_demands%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_produce is null or length(trim(p_produce)) not between 1 and 100 or p_quantity is null or p_quantity <= 0
     or p_unit is null or p_unit not in ('kg', 'crate', 'box') or p_location is null or length(trim(p_location)) = 0
     or (p_max_price is not null and p_max_price < 0) or p_required_by is null
     or (p_quality is not null and p_quality not in ('Premium', 'Good', 'Needs sorting'))
    then raise exception 'Buyer requirement values are invalid'; end if;
  select * into v_demand from public.buyer_demands where id = p_demand_id
    and buyer_id = (select auth.uid()) and status = 'published' for update;
  if not found then raise exception 'Buyer requirement is unavailable or not owned by this user'; end if;
  if v_demand.fulfilled_quantity > 0 or exists (
    select 1 from public.offers o where o.demand_id = v_demand.id and o.status = 'pending'
  ) then raise exception 'Resolve existing fulfilment or offers before editing this requirement'; end if;
  update public.buyer_demands set produce = trim(p_produce), quantity = p_quantity,
    unit = p_unit, max_price = p_max_price, location = trim(p_location), required_by = p_required_by,
    quality = p_quality, updated_at = now()
  where id = v_demand.id;
end;
$$;
revoke all on function private.update_buyer_demand(uuid, text, numeric, text, numeric, text, timestamptz, text) from public, anon;
grant execute on function private.update_buyer_demand(uuid, text, numeric, text, numeric, text, timestamptz, text) to authenticated;
create or replace function public.update_buyer_demand(
  p_demand_id uuid, p_produce text, p_quantity numeric, p_unit text, p_max_price numeric,
  p_location text, p_required_by timestamptz, p_quality text
) returns void language sql security invoker set search_path = ''
as $$ select private.update_buyer_demand($1,$2,$3,$4,$5,$6,$7,$8); $$;
revoke all on function public.update_buyer_demand(uuid, text, numeric, text, numeric, text, timestamptz, text) from public, anon;
grant execute on function public.update_buyer_demand(uuid, text, numeric, text, numeric, text, timestamptz, text) to authenticated;

create or replace function private.close_buyer_demand(p_demand_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_demand public.buyer_demands%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into v_demand from public.buyer_demands where id = p_demand_id
    and buyer_id = (select auth.uid()) and status = 'published' for update;
  if not found then raise exception 'Buyer requirement is unavailable or not owned by this user'; end if;
  if exists (select 1 from public.offers o where o.demand_id = v_demand.id and o.status = 'pending')
    then raise exception 'Resolve pending offers before closing this requirement'; end if;
  update public.buyer_demands set status = 'closed', is_published = false, updated_at = now()
  where id = v_demand.id;
end;
$$;
revoke all on function private.close_buyer_demand(uuid) from public, anon;
grant execute on function private.close_buyer_demand(uuid) to authenticated;
create or replace function public.close_buyer_demand(p_demand_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.close_buyer_demand($1); $$;
revoke all on function public.close_buyer_demand(uuid) from public, anon;
grant execute on function public.close_buyer_demand(uuid) to authenticated;

create or replace function private.approve_decision(
  p_decision_id uuid, p_quantity numeric, p_unit_price numeric,
  p_known_costs jsonb default '{}'::jsonb, p_delivery_feasible boolean default false
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_decision public.decisions%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_demand public.buyer_demands%rowtype;
  v_offer_id uuid;
  v_total_cost numeric(14,2);
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_quantity is null or p_quantity <= 0 or p_unit_price is null or p_unit_price <= 0
     or p_known_costs is null or jsonb_typeof(p_known_costs) <> 'object'
     or not (p_known_costs ?& array['transport','handling','storage','processing','platform'])
     or (select count(*) from jsonb_object_keys(p_known_costs)) <> 5
     or exists (select 1 from jsonb_each_text(p_known_costs) item(key,value)
       where key not in ('transport','handling','storage','processing','platform')
         or value !~ '^[0-9]+([.][0-9]{1,2})?$')
    then raise exception 'Provide valid non-negative costs for all five cost categories'; end if;
  select sum(value::numeric) into v_total_cost from jsonb_each_text(p_known_costs);
  if p_unit_price * p_quantity - v_total_cost < 0 then raise exception 'Known costs exceed proposed gross proceeds'; end if;
  if not coalesce(p_delivery_feasible, false) then raise exception 'Confirm route and delivery feasibility before submitting an offer'; end if;
  select * into v_decision from public.decisions where id = p_decision_id
    and owner_id = (select auth.uid()) and status = 'needs_review' for update;
  if not found then raise exception 'Decision is missing, already handled, or not owned by this user'; end if;
  select * into v_batch from public.inventory_batches where id = v_decision.inventory_id
    and owner_id = (select auth.uid()) and archived_at is null for update;
  if not found or v_batch.available_quantity < p_quantity or v_batch.status not in ('available','at_risk','partially_sold')
    then raise exception 'Inventory is unavailable or insufficient'; end if;
  select * into v_demand from public.buyer_demands where id = v_decision.demand_id
    and is_published and status = 'published' and required_by >= now() for update;
  if not found or v_demand.buyer_id = (select auth.uid())
     or lower(trim(v_demand.produce)) <> lower(trim(v_batch.produce))
     or v_demand.unit <> v_batch.unit
     or p_quantity > v_demand.quantity - v_demand.fulfilled_quantity
     or (v_demand.quality is not null and
       (case v_batch.quality when 'Needs sorting' then 1 when 'Good' then 2 else 3 end) <
       (case v_demand.quality when 'Needs sorting' then 1 when 'Good' then 2 else 3 end))
    then raise exception 'Buyer requirement is no longer compatible'; end if;
  if v_demand.max_price is not null and p_unit_price > v_demand.max_price then raise exception 'Price exceeds buyer limit'; end if;
  if v_batch.asking_price is not null and p_unit_price < v_batch.asking_price then raise exception 'Price is below seller asking price'; end if;
  insert into public.offers(decision_id, inventory_id, demand_id, seller_id, buyer_id,
    quantity, unit, unit_price, produce_snapshot, location_snapshot, known_costs)
  values (v_decision.id, v_batch.id, v_demand.id, (select auth.uid()), v_demand.buyer_id,
    p_quantity, v_batch.unit, p_unit_price, v_batch.produce, v_batch.location, p_known_costs)
  returning id into v_offer_id;
  insert into public.offer_events(offer_id, actor_id, event_type, quantity, unit_price)
  values (v_offer_id, (select auth.uid()), 'submitted', p_quantity, p_unit_price);
  update public.decisions set status = 'approved', user_action = 'offer_submitted',
    candidate_snapshot = candidate_snapshot || jsonb_build_object('seller_recorded_costs', p_known_costs),
    updated_at = now() where id = v_decision.id;
  return v_offer_id;
end;
$$;
revoke all on function private.approve_decision(uuid, numeric, numeric, jsonb, boolean) from public, anon;
grant execute on function private.approve_decision(uuid, numeric, numeric, jsonb, boolean) to authenticated;
create or replace function public.approve_decision(
  p_decision_id uuid, p_quantity numeric, p_unit_price numeric,
  p_known_costs jsonb default '{}'::jsonb, p_delivery_feasible boolean default false
) returns uuid language sql security invoker set search_path = ''
as $$ select private.approve_decision($1,$2,$3,$4,$5); $$;
revoke all on function public.approve_decision(uuid, numeric, numeric, jsonb, boolean) from public, anon;
grant execute on function public.approve_decision(uuid, numeric, numeric, jsonb, boolean) to authenticated;

create or replace function private.counter_offer(p_offer_id uuid, p_unit_price numeric)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_offer public.offers%rowtype; v_batch public.inventory_batches%rowtype; v_demand public.buyer_demands%rowtype; v_recipient uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_unit_price is null or p_unit_price <= 0 then raise exception 'Counter price must be positive'; end if;
  select * into v_offer from public.offers where id = p_offer_id and status = 'pending' for update;
  if not found then raise exception 'Offer is unavailable or already handled'; end if;
  v_recipient := case when v_offer.countered_by is null then v_offer.buyer_id
    when v_offer.countered_by = v_offer.buyer_id then v_offer.seller_id else v_offer.buyer_id end;
  if v_recipient <> (select auth.uid()) then raise exception 'Only the recipient of the latest terms can counter'; end if;
  select * into v_batch from public.inventory_batches where id = v_offer.inventory_id for update;
  select * into v_demand from public.buyer_demands where id = v_offer.demand_id for update;
  if v_batch.archived_at is not null or v_demand.status <> 'published' or v_demand.required_by < now()
    then raise exception 'Inventory or demand is no longer active'; end if;
  if v_demand.max_price is not null and p_unit_price > v_demand.max_price then raise exception 'Price exceeds buyer limit'; end if;
  if v_batch.asking_price is not null and p_unit_price < v_batch.asking_price then raise exception 'Price is below seller asking price'; end if;
  if p_unit_price * v_offer.quantity - (select sum(value::numeric) from jsonb_each_text(v_offer.known_costs)) < 0
    then raise exception 'Known costs exceed counter-offer gross proceeds'; end if;
  update public.offers set unit_price = p_unit_price, countered_by = (select auth.uid()), last_action_at = now()
  where id = v_offer.id;
  insert into public.offer_events(offer_id, actor_id, event_type, quantity, unit_price)
  values (v_offer.id, (select auth.uid()), 'countered', v_offer.quantity, p_unit_price);
end;
$$;
revoke all on function private.counter_offer(uuid, numeric) from public, anon;
grant execute on function private.counter_offer(uuid, numeric) to authenticated;
create or replace function public.counter_offer(p_offer_id uuid, p_unit_price numeric)
returns void language sql security invoker set search_path = ''
as $$ select private.counter_offer($1,$2); $$;
revoke all on function public.counter_offer(uuid, numeric) from public, anon;
grant execute on function public.counter_offer(uuid, numeric) to authenticated;

create or replace function private.respond_to_offer(p_offer_id uuid, p_action text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_offer public.offers%rowtype; v_batch public.inventory_batches%rowtype; v_demand public.buyer_demands%rowtype;
  v_recipient uuid; v_transaction_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_action is null or p_action not in ('accept','reject','cancel') then raise exception 'Unsupported offer action'; end if;
  select * into v_offer from public.offers where id = p_offer_id and status = 'pending' for update;
  if not found then raise exception 'Offer is unavailable or already handled'; end if;
  v_recipient := case when v_offer.countered_by is null then v_offer.buyer_id
    when v_offer.countered_by = v_offer.buyer_id then v_offer.seller_id else v_offer.buyer_id end;
  if p_action = 'cancel' then
    if (select auth.uid()) <> v_offer.seller_id then raise exception 'Only the seller can cancel this offer'; end if;
  elsif (select auth.uid()) <> v_recipient then
    raise exception 'Only the recipient of the latest terms can accept or reject';
  end if;
  if p_action <> 'accept' then
    update public.offers set status = case when p_action = 'reject' then 'rejected'::public.offer_status else 'cancelled'::public.offer_status end,
      last_action_at = now() where id = v_offer.id;
    insert into public.offer_events(offer_id, actor_id, event_type, quantity, unit_price)
    values (v_offer.id, (select auth.uid()), case p_action when 'reject' then 'rejected' else 'cancelled' end, v_offer.quantity, v_offer.unit_price);
    return null;
  end if;
  select * into v_batch from public.inventory_batches where id = v_offer.inventory_id for update;
  select * into v_demand from public.buyer_demands where id = v_offer.demand_id for update;
  if v_batch.archived_at is not null or v_batch.available_quantity < v_offer.quantity
     or v_batch.status not in ('available','at_risk','partially_sold')
     or v_demand.status <> 'published' or not v_demand.is_published or v_demand.required_by < now()
     or v_demand.quantity - v_demand.fulfilled_quantity < v_offer.quantity
     or lower(trim(v_demand.produce)) <> lower(trim(v_batch.produce)) or v_demand.unit <> v_batch.unit
     or (v_demand.quality is not null and
       (case v_batch.quality when 'Needs sorting' then 1 when 'Good' then 2 else 3 end) <
       (case v_demand.quality when 'Needs sorting' then 1 when 'Good' then 2 else 3 end))
    then raise exception 'Inventory or buyer requirement is no longer eligible'; end if;
  if not (v_offer.known_costs ?& array['transport','handling','storage','processing','platform'])
     or (select count(*) from jsonb_object_keys(v_offer.known_costs)) <> 5
     or exists (select 1 from jsonb_each_text(v_offer.known_costs) item(key,value)
       where key not in ('transport','handling','storage','processing','platform')
         or value !~ '^[0-9]+([.][0-9]{1,2})?$')
    then raise exception 'Offer is missing valid cost information; submit updated terms'; end if;
  if v_demand.max_price is not null and v_offer.unit_price > v_demand.max_price then raise exception 'Offer exceeds buyer price limit'; end if;
  if v_batch.asking_price is not null and v_offer.unit_price < v_batch.asking_price then raise exception 'Offer is below seller asking price'; end if;
  if v_offer.unit_price * v_offer.quantity - (select sum(value::numeric) from jsonb_each_text(v_offer.known_costs)) < 0
    then raise exception 'Known costs exceed accepted gross proceeds'; end if;
  update public.inventory_batches set available_quantity = available_quantity - v_offer.quantity,
    reserved_quantity = reserved_quantity + v_offer.quantity,
    status = case when available_quantity = v_offer.quantity then 'reserved'::public.inventory_status else status end,
    updated_at = now() where id = v_batch.id;
  update public.buyer_demands set fulfilled_quantity = fulfilled_quantity + v_offer.quantity,
    status = case when fulfilled_quantity + v_offer.quantity = quantity then 'fulfilled' else status end,
    updated_at = now() where id = v_demand.id;
  update public.offers set status = 'accepted', last_action_at = now() where id = v_offer.id;
  insert into public.transactions(offer_id, buyer_id, seller_id, accepted_quantity, unit, agreed_unit_price, known_costs)
  values (v_offer.id, v_offer.buyer_id, v_offer.seller_id, v_offer.quantity, v_offer.unit, v_offer.unit_price, v_offer.known_costs)
  returning id into v_transaction_id;
  insert into public.offer_events(offer_id, actor_id, event_type, quantity, unit_price)
  values (v_offer.id, (select auth.uid()), 'accepted', v_offer.quantity, v_offer.unit_price);
  return v_transaction_id;
end;
$$;

create or replace function private.accept_offer(p_offer_id uuid)
returns uuid language sql security definer set search_path = ''
as $$ select private.respond_to_offer($1, 'accept'); $$;
revoke all on function private.accept_offer(uuid) from public, anon;
grant execute on function private.accept_offer(uuid) to authenticated;
create or replace function public.accept_offer(p_offer_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select private.respond_to_offer($1, 'accept'); $$;
revoke all on function public.accept_offer(uuid) from public, anon;
grant execute on function public.accept_offer(uuid) to authenticated;
revoke all on function private.respond_to_offer(uuid, text) from public, anon;
grant execute on function private.respond_to_offer(uuid, text) to authenticated;
create or replace function public.respond_to_offer(p_offer_id uuid, p_action text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.respond_to_offer($1,$2); $$;
revoke all on function public.respond_to_offer(uuid, text) from public, anon;
grant execute on function public.respond_to_offer(uuid, text) to authenticated;

create or replace function private.outcome_audit_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.offer_events(offer_id, actor_id, event_type, quantity, unit_price)
  select t.offer_id, new.recorded_by, 'seller_reported_handover', new.accepted_quantity,
         case when new.accepted_quantity > 0 then new.gross_value / new.accepted_quantity else null end
  from public.transactions t where t.id = new.transaction_id;
  return new;
end;
$$;
revoke all on function private.outcome_audit_event() from public, anon, authenticated;
create trigger freshflow_outcome_audit_event
  after insert on public.outcomes for each row execute function private.outcome_audit_event();

create or replace function private.confirm_transaction_handover(p_transaction_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_offer_id uuid; v_outcome_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select t.offer_id into v_offer_id from public.transactions t
  where t.id = p_transaction_id and t.buyer_id = (select auth.uid())
    and t.completion_status = 'completed' for update;
  if not found then raise exception 'Completed transaction is unavailable or not addressed to this buyer'; end if;
  update public.outcomes set verification_status = 'buyer_confirmed',
    buyer_confirmed_by = (select auth.uid()), buyer_confirmed_at = now()
  where transaction_id = p_transaction_id and verification_status = 'seller_reported'
  returning id into v_outcome_id;
  if not found then raise exception 'Outcome is missing or already confirmed'; end if;
  insert into public.offer_events(offer_id, actor_id, event_type)
  values (v_offer_id, (select auth.uid()), 'buyer_confirmed_handover');
end;
$$;
revoke all on function private.confirm_transaction_handover(uuid) from public, anon;
grant execute on function private.confirm_transaction_handover(uuid) to authenticated;
create or replace function public.confirm_transaction_handover(p_transaction_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.confirm_transaction_handover($1); $$;
revoke all on function public.confirm_transaction_handover(uuid) from public, anon;
grant execute on function public.confirm_transaction_handover(uuid) to authenticated;

create or replace function private.transition_buyer_demand(p_demand_id uuid, p_action text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_demand public.buyer_demands%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into v_demand from public.buyer_demands where id = p_demand_id
    and buyer_id = (select auth.uid()) and status = 'published' for update;
  if not found then raise exception 'Buyer requirement is unavailable or not owned by this user'; end if;
  if p_action is null or p_action not in ('close','cancel') then raise exception 'Unsupported demand action'; end if;
  if exists (select 1 from public.offers o where o.demand_id = v_demand.id and o.status = 'pending')
    then raise exception 'Resolve pending offers before closing this requirement'; end if;
  update public.buyer_demands set status = case when p_action = 'close' then 'closed' else 'cancelled' end,
    is_published = false, updated_at = now() where id = v_demand.id;
end;
$$;
revoke all on function private.transition_buyer_demand(uuid, text) from public, anon;
grant execute on function private.transition_buyer_demand(uuid, text) to authenticated;
create or replace function public.transition_buyer_demand(p_demand_id uuid, p_action text)
returns void language sql security invoker set search_path = ''
as $$ select private.transition_buyer_demand($1,$2); $$;
revoke all on function public.transition_buyer_demand(uuid, text) from public, anon;
grant execute on function public.transition_buyer_demand(uuid, text) to authenticated;

-- Live moderation authority comes only from a trusted app_metadata JWT claim.
-- Public demo moderation is implemented separately in the browser and never calls these RPCs.
create table if not exists public.inventory_moderation_events (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.inventory_batches(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved', 'rejected')),
  note text,
  created_at timestamptz not null default now()
);
alter table public.inventory_moderation_events enable row level security;
create policy "Admins read inventory moderation history" on public.inventory_moderation_events
  for select to authenticated using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
grant select on public.inventory_moderation_events to authenticated;
revoke all on public.inventory_moderation_events from anon, public;

create or replace function private.admin_list_inventory_submissions()
returns table (
  batch_id uuid, owner_id uuid, produce text, quantity numeric, unit text, location text,
  quality text, available_at timestamptz, harvested_or_purchased_at timestamptz,
  freshness_hours integer, photo_path text, moderation_status text, submitted_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin'
    then raise exception 'Admin authorization required'; end if;
  return query select b.id, b.owner_id, b.produce, b.quantity, b.unit, b.location, b.quality,
    b.available_at, b.harvested_or_purchased_at, b.freshness_hours, b.photo_path,
    b.moderation_status, coalesce(b.moderation_submitted_at, b.created_at)
  from public.inventory_batches b where b.moderation_status in ('pending_review', 'approved', 'rejected')
  order by (b.moderation_status <> 'pending_review'), b.updated_at desc;
end;
$$;
revoke all on function private.admin_list_inventory_submissions() from public, anon;
grant execute on function private.admin_list_inventory_submissions() to authenticated;
create or replace function public.admin_list_inventory_submissions()
returns table (
  batch_id uuid, owner_id uuid, produce text, quantity numeric, unit text, location text,
  quality text, available_at timestamptz, harvested_or_purchased_at timestamptz,
  freshness_hours integer, photo_path text, moderation_status text, submitted_at timestamptz
)
language sql security invoker set search_path = ''
as $$ select * from private.admin_list_inventory_submissions(); $$;
revoke all on function public.admin_list_inventory_submissions() from public, anon;
grant execute on function public.admin_list_inventory_submissions() to authenticated;

create or replace function private.review_inventory_submission(p_batch_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_batch public.inventory_batches%rowtype;
begin
  if (select auth.uid()) is null or (select auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin'
    then raise exception 'Admin authorization required'; end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject'; end if;
  select * into v_batch from public.inventory_batches where id = p_batch_id for update;
  if not found or v_batch.moderation_status <> 'pending_review' then
    raise exception 'Submission is missing or no longer pending review'; end if;
  update public.inventory_batches set moderation_status = p_decision,
    is_published = (p_decision = 'approved'), updated_at = now()
  where id = p_batch_id;
  insert into public.inventory_moderation_events(batch_id, actor_id, decision, note)
  values (p_batch_id, (select auth.uid()), p_decision, nullif(trim(p_note), ''));
end;
$$;
revoke all on function private.review_inventory_submission(uuid, text, text) from public, anon;
grant execute on function private.review_inventory_submission(uuid, text, text) to authenticated;
create or replace function public.review_inventory_submission(p_batch_id uuid, p_decision text, p_note text default null)
returns void language sql security invoker set search_path = ''
as $$ select private.review_inventory_submission($1,$2,$3); $$;
revoke all on function public.review_inventory_submission(uuid, text, text) from public, anon;
grant execute on function public.review_inventory_submission(uuid, text, text) to authenticated;

revoke insert (is_published) on public.inventory_batches from authenticated;
revoke update (is_published) on public.inventory_batches from authenticated;
create policy "Admins read pending inventory photo evidence" on storage.objects
  for select to authenticated using (
    bucket_id = 'inventory-photos'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );
