-- =====================================================================
-- 0126: bank details for /billing live in the database, not in Vercel
-- environment variables. Edited by superadmin on /payments; changing
-- them needs no redeploy. Single row (id = 1). Readable by any signed-in
-- account on purpose — it is exactly what a customer is shown to pay.
-- =====================================================================

create table if not exists billing_settings (
  id           int primary key default 1 check (id = 1),
  bank_name    text not null default '',
  bank_account text not null default '',
  bank_holder  text not null default '',
  whatsapp     text not null default '',
  updated_at   timestamptz not null default now()
);
insert into billing_settings (id) values (1) on conflict (id) do nothing;

alter table billing_settings enable row level security;
drop policy if exists billing_settings_read on billing_settings;
create policy billing_settings_read on billing_settings
  for select to authenticated using (true);
drop policy if exists billing_settings_super on billing_settings;
create policy billing_settings_super on billing_settings
  for all using ((select my_role())::text = 'superadmin')
  with check ((select my_role())::text = 'superadmin');

notify pgrst, 'reload config';
