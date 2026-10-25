-- Noodle cloud sync: run this once in your Supabase project's SQL editor.
-- Every row and file belongs to the signed-in user; nobody else can read it.

create table if not exists public.notes (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  path text not null,
  -- 'note' (Markdown text in content), 'folder', or 'file' (bytes in storage)
  kind text not null default 'note' check (kind in ('note', 'folder', 'file')),
  content text not null default '',
  -- SHA-256 of the contents, so devices can tell what changed without downloading
  hash text not null default '',
  deleted boolean not null default false,
  device text,
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

create index if not exists notes_user_updated on public.notes (user_id, updated_at);

create or replace function public.notes_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before insert or update on public.notes
  for each row execute function public.notes_touch();

alter table public.notes enable row level security;

drop policy if exists "own notes: read" on public.notes;
drop policy if exists "own notes: add" on public.notes;
drop policy if exists "own notes: change" on public.notes;
drop policy if exists "own notes: remove" on public.notes;
create policy "own notes: read" on public.notes for select using (auth.uid() = user_id);
create policy "own notes: add" on public.notes for insert with check (auth.uid() = user_id);
create policy "own notes: change" on public.notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own notes: remove" on public.notes for delete using (auth.uid() = user_id);

-- Live updates between devices.
do $$
begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null;
end $$;

-- Pictures and other attachments, stored under <user id>/<vault path>.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists "own files: read" on storage.objects;
drop policy if exists "own files: add" on storage.objects;
drop policy if exists "own files: change" on storage.objects;
drop policy if exists "own files: remove" on storage.objects;
create policy "own files: read" on storage.objects for select
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files: add" on storage.objects for insert
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files: change" on storage.objects for update
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files: remove" on storage.objects for delete
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
