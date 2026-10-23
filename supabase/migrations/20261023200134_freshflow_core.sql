create extension if not exists pgcrypto;

create type public.inventory_status as enum ('available', 'at_risk', 'reserved', 'partially_sold', 'completed', 'unavailable');
create type public.offer_status as enum ('pending', 'accepted', 'rejected', 'cancelled', 'completed');
create type public.decision_status as enum ('needs_review', 'approved', 'completed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  preferred_language text not null default 'en' check (preferred_language in ('en', 'ml', 'hi', 'ta')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  produce text not null check (length(trim(produce)) between 1 and 100),
  quantity numeric(14,3) not null check (quantity > 0),
  available_quantity numeric(14,3) not null check (available_quantity >= 0 and available_quantity <= quantity),
  reserved_quantity numeric(14,3) not null default 0 check (reserved_quantity >= 0),
  sold_quantity numeric(14,3) not null default 0 check (sold_quantity >= 0),
  unit text not null check (unit in ('kg', 'crate', 'box')),
  location text not null,
  quality text not null check (quality in ('Premium', 'Good', 'Needs sorting')),
  asking_price numeric(14,2) check (asking_price is null or asking_price >= 0),
  purchase_cost numeric(14,2) check (purchase_cost is null or purchase_cost >= 0),
  available_at timestamptz not null default now(),
  freshness_hours integer check (freshness_hours is null or freshness_hours > 0),
  status public.inventory_status not null default 'available',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (available_quantity + reserved_quantity + sold_quantity <= quantity)
);

create table public.buyer_demands (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete restrict,
  produce text not null check (length(trim(produce)) between 1 and 100),
  quantity numeric(14,3) not null check (quantity > 0),
  fulfilled_quantity numeric(14,3) not null default 0 check (fulfilled_quantity >= 0 and fulfilled_quantity <= quantity),
  unit text not null check (unit in ('kg', 'crate', 'box')),
  max_price numeric(14,2) check (max_price is null or max_price >= 0),
  location text not null,
  required_by timestamptz not null,
  quality text check (quality is null or quality in ('Premium', 'Good', 'Needs sorting')),
  status text not null default 'published' check (status in ('draft', 'published', 'fulfilled', 'closed', 'expired', 'cancelled')),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  inventory_id uuid not null references public.inventory_batches(id) on delete restrict,
  demand_id uuid not null references public.buyer_demands(id) on delete restrict,
  candidate_snapshot jsonb not null default '{}'::jsonb,
  status public.decision_status not null default 'needs_review',
  user_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null unique references public.decisions(id) on delete restrict,
  inventory_id uuid not null references public.inventory_batches(id) on delete restrict,
  demand_id uuid not null references public.buyer_demands(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null check (unit in ('kg', 'crate', 'box')),
  unit_price numeric(14,2) not null check (unit_price > 0),
  produce_snapshot text not null,
  location_snapshot text not null,
  status public.offer_status not null default 'pending',
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references public.offers(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  accepted_quantity numeric(14,3) not null check (accepted_quantity > 0),
  unit text not null check (unit in ('kg', 'crate', 'box')),
  agreed_unit_price numeric(14,2) not null check (agreed_unit_price > 0),
  known_costs jsonb not null default '{}'::jsonb,
  completion_status text not null default 'handover_pending' check (completion_status in ('handover_pending', 'completed', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.outcomes (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  batch_id uuid not null references public.inventory_batches(id) on delete restrict,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  accepted_quantity numeric(14,3) not null check (accepted_quantity > 0),
  gross_value numeric(14,2) not null check (gross_value >= 0),
  known_costs jsonb not null default '{}'::jsonb,
  net_proceeds numeric(14,2),
  costs_complete boolean not null default false,
  recorded_at timestamptz not null default now()
);

create index inventory_batches_owner_status_idx on public.inventory_batches(owner_id, status);
create index buyer_demands_published_idx on public.buyer_demands(status, required_by) where is_published;
create index decisions_owner_status_idx on public.decisions(owner_id, status);
create index offers_participants_idx on public.offers(seller_id, buyer_id, status);

alter table public.profiles enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.buyer_demands enable row level security;
alter table public.decisions enable row level security;
alter table public.offers enable row level security;
alter table public.transactions enable row level security;
alter table public.outcomes enable row level security;

create policy "Profiles are readable by their owner" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Users create their own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "Users update their own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Owners read inventory and users discover published batches" on public.inventory_batches for select to authenticated using ((select auth.uid()) = owner_id or is_published);
create policy "Owners create inventory" on public.inventory_batches for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners update inventory" on public.inventory_batches for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owners delete unpublished inventory" on public.inventory_batches for delete to authenticated using ((select auth.uid()) = owner_id and not is_published and reserved_quantity = 0);

create policy "Buyers read own or published demand" on public.buyer_demands for select to authenticated using ((select auth.uid()) = buyer_id or (is_published and status = 'published'));
create policy "Buyers create demand" on public.buyer_demands for insert to authenticated with check ((select auth.uid()) = buyer_id);
create policy "Buyers update own demand" on public.buyer_demands for update to authenticated using ((select auth.uid()) = buyer_id) with check ((select auth.uid()) = buyer_id);
create policy "Buyers delete own draft demand" on public.buyer_demands for delete to authenticated using ((select auth.uid()) = buyer_id and status = 'draft');

create policy "Decision owners manage decisions" on public.decisions for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Offer participants read offers" on public.offers for select to authenticated using ((select auth.uid()) in (seller_id, buyer_id));
create policy "Sellers create offers for their inventory" on public.offers for insert to authenticated with check ((select auth.uid()) = seller_id and exists (select 1 from public.inventory_batches b where b.id = inventory_id and b.owner_id = (select auth.uid())));
create policy "Offer participants read transactions" on public.transactions for select to authenticated using ((select auth.uid()) in (seller_id, buyer_id));
create policy "Offer participants read outcomes" on public.outcomes for select to authenticated using (exists (select 1 from public.transactions t where t.id = transaction_id and (select auth.uid()) in (t.seller_id, t.buyer_id)));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.decisions to authenticated;
grant select, delete on public.inventory_batches to authenticated;
grant insert (owner_id, produce, quantity, available_quantity, unit, location, quality, asking_price, purchase_cost, available_at, freshness_hours, is_published) on public.inventory_batches to authenticated;
grant update (is_published) on public.inventory_batches to authenticated;
grant select, delete on public.buyer_demands to authenticated;
grant insert (buyer_id, produce, quantity, unit, max_price, location, required_by, quality, status, is_published) on public.buyer_demands to authenticated;
grant update (is_published) on public.buyer_demands to authenticated;
grant select on public.offers to authenticated;
grant select on public.transactions, public.outcomes to authenticated;

-- Seller approval submits an offer. Buyer acceptance below performs the stock reservation.
create or replace function public.approve_decision(p_decision_id uuid, p_quantity numeric, p_unit_price numeric, p_known_costs jsonb default '{}'::jsonb, p_delivery_feasible boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decision public.decisions%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_demand public.buyer_demands%rowtype;
  v_offer_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_quantity <= 0 or p_unit_price <= 0 then raise exception 'Quantity and price must be positive'; end if;
  if not p_delivery_feasible then raise exception 'Confirm route and delivery feasibility before submitting an offer'; end if;
  select * into v_decision from public.decisions where id = p_decision_id and owner_id = auth.uid() and status = 'needs_review' for update;
  if not found then raise exception 'Decision is missing, already handled, or not owned by this user'; end if;
  select * into v_batch from public.inventory_batches where id = v_decision.inventory_id and owner_id = auth.uid() for update;
  if not found or v_batch.available_quantity < p_quantity then raise exception 'Insufficient available inventory'; end if;
  select * into v_demand from public.buyer_demands where id = v_decision.demand_id and is_published and status = 'published' and required_by >= now();
  if not found or v_demand.buyer_id = auth.uid() or v_demand.produce <> v_batch.produce or v_demand.unit <> v_batch.unit or p_quantity > v_demand.quantity - v_demand.fulfilled_quantity then raise exception 'Buyer requirement is no longer eligible'; end if;
  if v_demand.max_price is not null and p_unit_price > v_demand.max_price then raise exception 'Price exceeds buyer limit'; end if;
  if v_batch.asking_price is not null and p_unit_price < v_batch.asking_price then raise exception 'Price is below seller asking price'; end if;
  if v_demand.quality is not null and (case v_batch.quality when 'Needs sorting' then 1 when 'Good' then 2 else 3 end) < (case v_demand.quality when 'Needs sorting' then 1 when 'Good' then 2 else 3 end) then raise exception 'Inventory quality does not meet buyer requirement'; end if;
  if jsonb_typeof(coalesce(p_known_costs, '{}'::jsonb)) <> 'object' or exists (
    select 1 from jsonb_each_text(coalesce(p_known_costs, '{}'::jsonb)) as item(key, value)
    where key not in ('transport', 'handling', 'storage', 'processing', 'platform')
      or case when value ~ '^[0-9]+([.][0-9]+)?$' then value::numeric < 0 else true end
  ) then raise exception 'Costs must be non-negative amounts for supported cost categories'; end if;
  -- Seller approval submits an offer. The buyer still needs to accept it before stock is reserved.
  insert into public.offers(decision_id, inventory_id, demand_id, seller_id, buyer_id, quantity, unit, unit_price, produce_snapshot, location_snapshot)
    values (v_decision.id, v_batch.id, v_demand.id, auth.uid(), v_demand.buyer_id, p_quantity, v_batch.unit, p_unit_price, v_batch.produce, v_batch.location) returning id into v_offer_id;
  update public.decisions set status = 'approved', user_action = 'offer_submitted', candidate_snapshot = candidate_snapshot || jsonb_build_object('seller_recorded_costs', coalesce(p_known_costs, '{}'::jsonb)), updated_at = now() where id = v_decision.id;
  return v_offer_id;
end;
$$;

grant execute on function public.approve_decision(uuid, numeric, numeric, jsonb, boolean) to authenticated;
revoke execute on function public.approve_decision(uuid, numeric, numeric, jsonb, boolean) from public, anon;

-- Buyer acceptance is a separate explicit action. Locking the offer, stock and demand prevents
-- concurrent accepts from overbooking either inventory or the buyer's total requested quantity.
create or replace function public.accept_offer(p_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.offers%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_demand public.buyer_demands%rowtype;
  v_transaction_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into v_offer from public.offers where id = p_offer_id and buyer_id = (select auth.uid()) and status = 'pending' for update;
  if not found then raise exception 'Offer is missing, already handled, or not addressed to this user'; end if;
  select * into v_batch from public.inventory_batches where id = v_offer.inventory_id for update;
  select * into v_demand from public.buyer_demands where id = v_offer.demand_id and buyer_id = (select auth.uid()) for update;
  if not found or v_demand.status <> 'published' or v_demand.required_by < now() then raise exception 'Buyer requirement is no longer active'; end if;
  if v_batch.available_quantity < v_offer.quantity then raise exception 'Insufficient available inventory'; end if;
  if v_demand.fulfilled_quantity + v_offer.quantity > v_demand.quantity then raise exception 'Offer exceeds remaining buyer requirement'; end if;
  update public.inventory_batches set available_quantity = available_quantity - v_offer.quantity, reserved_quantity = reserved_quantity + v_offer.quantity,
    status = case when available_quantity = v_offer.quantity then 'reserved'::public.inventory_status else status end, updated_at = now() where id = v_batch.id;
  update public.buyer_demands set fulfilled_quantity = fulfilled_quantity + v_offer.quantity, status = case when fulfilled_quantity + v_offer.quantity = quantity then 'fulfilled' else status end, updated_at = now() where id = v_demand.id;
  update public.offers set status = 'accepted' where id = v_offer.id;
  insert into public.transactions(offer_id, buyer_id, seller_id, accepted_quantity, unit, agreed_unit_price)
    values (v_offer.id, v_offer.buyer_id, v_offer.seller_id, v_offer.quantity, v_offer.unit, v_offer.unit_price) returning id into v_transaction_id;
  return v_transaction_id;
end;
$$;
revoke execute on function public.accept_offer(uuid) from public, anon;
grant execute on function public.accept_offer(uuid) to authenticated;

create or replace function public.complete_transaction(p_transaction_id uuid, p_accepted_quantity numeric, p_known_costs jsonb, p_costs_complete boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_gross numeric(14,2);
  v_net numeric(14,2);
  v_outcome_id uuid;
  v_costs_complete boolean;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_accepted_quantity <= 0 then raise exception 'Accepted quantity must be positive'; end if;
  if jsonb_typeof(coalesce(p_known_costs, '{}'::jsonb)) <> 'object' or exists (
    select 1 from jsonb_each_text(coalesce(p_known_costs, '{}'::jsonb)) as item(key, value)
    where key not in ('transport', 'handling', 'storage', 'processing', 'platform')
      or case when value ~ '^[0-9]+([.][0-9]+)?$' then value::numeric < 0 else true end
  ) then raise exception 'Costs must be non-negative amounts for supported cost categories'; end if;
  select * into v_tx from public.transactions where id = p_transaction_id and seller_id = (select auth.uid()) and completion_status = 'handover_pending' for update;
  if not found or p_accepted_quantity > v_tx.accepted_quantity then raise exception 'Transaction is unavailable or quantity exceeds reservation'; end if;
  select * into v_batch from public.inventory_batches where id = (select inventory_id from public.offers where id = v_tx.offer_id) and owner_id = (select auth.uid()) for update;
  if not found or p_accepted_quantity > v_batch.reserved_quantity then raise exception 'Reserved stock is unavailable'; end if;
  v_gross := p_accepted_quantity * v_tx.agreed_unit_price;
  v_costs_complete := coalesce(p_costs_complete, false) and (coalesce(p_known_costs, '{}'::jsonb) ?& array['transport', 'handling', 'storage', 'processing', 'platform']);
  v_net := case when v_costs_complete then v_gross - coalesce((select sum(value::numeric) from jsonb_each_text(coalesce(p_known_costs, '{}'::jsonb))), 0) else null end;
  update public.inventory_batches set reserved_quantity = reserved_quantity - v_tx.accepted_quantity, available_quantity = available_quantity + v_tx.accepted_quantity - p_accepted_quantity, sold_quantity = sold_quantity + p_accepted_quantity,
    status = case when sold_quantity + p_accepted_quantity = quantity then 'completed'::public.inventory_status when sold_quantity + p_accepted_quantity > 0 then 'partially_sold'::public.inventory_status else status end, updated_at = now() where id = v_batch.id;
  update public.transactions set accepted_quantity = p_accepted_quantity, known_costs = coalesce(p_known_costs, '{}'::jsonb), completion_status = 'completed', completed_at = now() where id = v_tx.id;
  update public.buyer_demands set fulfilled_quantity = fulfilled_quantity - (v_tx.accepted_quantity - p_accepted_quantity), status = case when fulfilled_quantity - (v_tx.accepted_quantity - p_accepted_quantity) < quantity then 'published' else status end, updated_at = now() where id = (select demand_id from public.offers where id = v_tx.offer_id);
  insert into public.outcomes(transaction_id, batch_id, recorded_by, accepted_quantity, gross_value, known_costs, net_proceeds, costs_complete)
    values (v_tx.id, v_batch.id, (select auth.uid()), p_accepted_quantity, v_gross, coalesce(p_known_costs, '{}'::jsonb), v_net, v_costs_complete) returning id into v_outcome_id;
  update public.offers set status = 'completed' where id = v_tx.offer_id;
  update public.decisions set status = 'completed', user_action = 'completed', updated_at = now() where id = (select decision_id from public.offers where id = v_tx.offer_id);
  return v_outcome_id;
end;
$$;

grant execute on function public.complete_transaction(uuid, numeric, jsonb, boolean) to authenticated;
revoke execute on function public.complete_transaction(uuid, numeric, jsonb, boolean) from public, anon;
