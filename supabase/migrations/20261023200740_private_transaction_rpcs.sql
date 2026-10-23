-- Keep privileged transaction logic outside the PostgREST-exposed public schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.approve_decision(uuid, numeric, numeric, jsonb, boolean) set schema private;
alter function public.accept_offer(uuid) set schema private;
alter function public.complete_transaction(uuid, numeric, jsonb, boolean) set schema private;

grant execute on function private.approve_decision(uuid, numeric, numeric, jsonb, boolean) to authenticated;
grant execute on function private.accept_offer(uuid) to authenticated;
grant execute on function private.complete_transaction(uuid, numeric, jsonb, boolean) to authenticated;
revoke execute on function private.approve_decision(uuid, numeric, numeric, jsonb, boolean) from public, anon;
revoke execute on function private.accept_offer(uuid) from public, anon;
revoke execute on function private.complete_transaction(uuid, numeric, jsonb, boolean) from public, anon;

-- Public invoker wrappers are the only RPC entry points. The private routines validate auth.uid().
create function public.approve_decision(
  p_decision_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_known_costs jsonb default '{}'::jsonb,
  p_delivery_feasible boolean default false
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.approve_decision(p_decision_id, p_quantity, p_unit_price, p_known_costs, p_delivery_feasible); $$;

create function public.accept_offer(p_offer_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.accept_offer(p_offer_id); $$;

create function public.complete_transaction(p_transaction_id uuid, p_accepted_quantity numeric, p_known_costs jsonb, p_costs_complete boolean)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.complete_transaction(p_transaction_id, p_accepted_quantity, p_known_costs, p_costs_complete); $$;

grant execute on function public.approve_decision(uuid, numeric, numeric, jsonb, boolean) to authenticated;
grant execute on function public.accept_offer(uuid) to authenticated;
grant execute on function public.complete_transaction(uuid, numeric, jsonb, boolean) to authenticated;
revoke execute on function public.approve_decision(uuid, numeric, numeric, jsonb, boolean) from public, anon;
revoke execute on function public.accept_offer(uuid) from public, anon;
revoke execute on function public.complete_transaction(uuid, numeric, jsonb, boolean) from public, anon;

-- PostgreSQL does not automatically index referencing foreign-key columns.
create index if not exists buyer_demands_buyer_id_idx on public.buyer_demands(buyer_id);
create index if not exists decisions_inventory_id_idx on public.decisions(inventory_id);
create index if not exists decisions_demand_id_idx on public.decisions(demand_id);
create index if not exists offers_inventory_id_idx on public.offers(inventory_id);
create index if not exists offers_demand_id_idx on public.offers(demand_id);
create index if not exists offers_buyer_status_idx on public.offers(buyer_id, status);
create index if not exists outcomes_batch_id_idx on public.outcomes(batch_id);
create index if not exists outcomes_recorded_by_idx on public.outcomes(recorded_by);
create index if not exists transactions_buyer_id_idx on public.transactions(buyer_id);
create index if not exists transactions_seller_id_idx on public.transactions(seller_id);
