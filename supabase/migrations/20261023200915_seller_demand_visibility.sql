-- Sellers need the original requirement while an accepted offer is awaiting handover,
-- even after fulfillment has hidden it from new matches.
create policy "Sellers read requirements linked to their offers"
on public.buyer_demands
for select to authenticated
using (
  exists (
    select 1
    from public.offers o
    where o.demand_id = buyer_demands.id
      and o.seller_id = (select auth.uid())
  )
);
