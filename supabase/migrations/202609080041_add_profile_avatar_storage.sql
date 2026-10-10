-- Public profile avatars with authenticated owner-only writes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  8388608,
  array['image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users upload their own profile avatar"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and storage.filename(name) = 'avatar.jpg'
);

create policy "Users read their own profile avatar"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and storage.filename(name) = 'avatar.jpg'
);

create policy "Users replace their own profile avatar"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-avatars'
  and owner_id = auth.uid()::text
  and (storage.foldername(name))[1] = auth.uid()::text
  and storage.filename(name) = 'avatar.jpg'
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and storage.filename(name) = 'avatar.jpg'
);

create policy "Users remove their own profile avatar"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and owner_id = auth.uid()::text
  and (storage.foldername(name))[1] = auth.uid()::text
  and storage.filename(name) = 'avatar.jpg'
);
