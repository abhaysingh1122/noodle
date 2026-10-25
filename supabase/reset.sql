-- Wipes Noodle Cloud completely: every account, vault and note. This can't be undone.
-- Run it in the SQL editor, empty the "attachments" bucket in Storage, then run schema.sql.

drop table if exists public.notes cascade;
drop table if exists public.vaults cascade;
drop function if exists public.notes_touch() cascade;
drop function if exists public.keepalive() cascade;

-- Every sign-in account (they'll need to sign up again).
delete from auth.users;
