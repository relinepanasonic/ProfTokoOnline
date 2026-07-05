-- 0031_company_scoping.sql
-- Scope Product Packages and Invoices to one of the 3 companies
-- (Profesor Toko Online, New Wave Agency, PT Pintu Langit).
-- `packages` and `invoices` were originally created directly in the
-- Supabase dashboard (no earlier migration defines them), so this uses
-- ALTER TABLE ... IF NOT EXISTS and is safe to re-run.

alter table packages add column if not exists company text;
alter table invoices add column if not exists company text;

-- Backfill existing rows — everything so far belongs to Profesor Toko Online.
update packages set company = 'Profesor Toko Online' where company is null;
update invoices set company = 'Profesor Toko Online' where company is null;

alter table packages drop constraint if exists packages_company_check;
alter table packages add constraint packages_company_check
  check (company in ('Profesor Toko Online', 'New Wave Agency', 'PT Pintu Langit'));

alter table invoices drop constraint if exists invoices_company_check;
alter table invoices add constraint invoices_company_check
  check (company in ('Profesor Toko Online', 'New Wave Agency', 'PT Pintu Langit'));

create index if not exists packages_company_idx on packages(company);
create index if not exists invoices_company_idx on invoices(company);
