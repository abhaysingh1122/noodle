-- Noodle Cloud: run this once in the Supabase project's SQL editor.
-- One project holds every account. Each account has its own vaults, and each
-- vault its own notes, folders and attachments. Nobody can see anyone else's.

create table if not exists public.vaults (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  -- bumped whenever anything in the vault changes, so the newest vault shows first
  updated_at timestamptz not null default now()
);

create index if not exists vaults_user_updated on public.vaults (user_id, updated_at desc);

create table if not exists public.notes (
  vault_id uuid not null references public.vaults on delete cascade,
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
  primary key (vault_id, path)
);

create index if not exists notes_vault_updated on public.notes (vault_id, updated_at);

create or replace function public.notes_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  -- now() is fixed within a transaction, so a big upload touches the vault once
  update public.vaults set updated_at = now() where id = new.vault_id and updated_at < now();
  return new;
end $$;

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before insert or update on public.notes
  for each row execute function public.notes_touch();

alter table public.vaults enable row level security;
alter table public.notes enable row level security;

drop policy if exists "own vaults" on public.vaults;
create policy "own vaults" on public.vaults for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own notes: read" on public.notes;
drop policy if exists "own notes: add" on public.notes;
drop policy if exists "own notes: change" on public.notes;
drop policy if exists "own notes: remove" on public.notes;
create policy "own notes: read" on public.notes for select using (auth.uid() = user_id);
create policy "own notes: add" on public.notes for insert with check (
  auth.uid() = user_id and exists (select 1 from public.vaults v where v.id = vault_id and v.user_id = auth.uid())
);
create policy "own notes: change" on public.notes for update using (auth.uid() = user_id) with check (
  auth.uid() = user_id and exists (select 1 from public.vaults v where v.id = vault_id and v.user_id = auth.uid())
);
create policy "own notes: remove" on public.notes for delete using (auth.uid() = user_id);

-- Live updates between devices.
do $$
begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.vaults;
exception when duplicate_object then null;
end $$;

-- A tiny query the scheduled keep-awake job calls, so a quiet project isn't paused.
create or replace function public.keepalive() returns text language sql stable as $$ select 'ok'::text $$;
grant execute on function public.keepalive() to anon, authenticated;

-- Pictures and other attachments, stored under <user id>/<vault id>/<hash>.
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
