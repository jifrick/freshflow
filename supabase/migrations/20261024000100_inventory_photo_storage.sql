alter table public.inventory_batches add column if not exists photo_path text;
grant update (is_published, photo_path) on public.inventory_batches to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventory-photos', 'inventory-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Owners upload inventory photos to their folder"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'inventory-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Owners read inventory photos from their folder"
on storage.objects
for select to authenticated
using (
  bucket_id = 'inventory-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Owners delete inventory photos from their folder"
on storage.objects
for delete to authenticated
using (
  bucket_id = 'inventory-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
