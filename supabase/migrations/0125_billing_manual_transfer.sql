-- =====================================================================
-- 0125: Billing v1 — manual bank transfer, no payment gateway.
--
-- First sellable plan: "calc" (Price Calculator only, Rp 25.000/month).
--
-- Flow: Owner opens /billing -> request_payment() creates a pending
-- request with a UNIQUE CODE (Rp 1-99) added to the price, so the exact
-- amount identifies the buyer in the bank statement -> Owner transfers
-- and uploads the proof -> superadmin approves (approve_payment()) which
-- sets the plan and extends subscription_end. Price lives in
-- billing_plans and is read SERVER-SIDE inside request_payment() — the
-- client can never choose its own amount, plan end date, or role.
--
-- Everything that changes money/plan state is a SECURITY DEFINER RPC with
-- its own role check; owners get NO direct insert/update on
-- payment_requests. Policy calls are wrapped as (select ...) (see 0108).
-- =====================================================================

-- ── 1. new plan value ────────────────────────────────────────────────
alter table profiles drop constraint if exists profiles_plan_chk;
alter table profiles add constraint profiles_plan_chk
  check (plan_type is null or plan_type in ('lapak','sultan','king','prof','calc'));

-- ── 2. billing_plans: single source of truth for prices ──────────────
create table if not exists billing_plans (
  plan_type       text primary key,
  label           text not null,
  price_per_month bigint not null check (price_per_month > 0),
  active          boolean not null default true
);
insert into billing_plans (plan_type, label, price_per_month)
  values ('calc', 'Price Calculator', 25000)
  on conflict (plan_type) do nothing;

alter table billing_plans enable row level security;
drop policy if exists billing_plans_read on billing_plans;
create policy billing_plans_read on billing_plans
  for select to authenticated using (true);
drop policy if exists billing_plans_super on billing_plans;
create policy billing_plans_super on billing_plans
  for all using ((select my_role())::text = 'superadmin')
  with check ((select my_role())::text = 'superadmin');

-- ── 3. payment_requests ──────────────────────────────────────────────
create table if not exists payment_requests (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  client_id    uuid references clients(id) on delete set null,
  plan_type    text not null references billing_plans(plan_type),
  months       int  not null check (months between 1 and 24),
  base_amount  bigint not null,
  unique_code  int  not null check (unique_code between 1 and 99),
  amount       bigint not null,            -- exact amount to transfer
  status       text not null default 'pending'
               check (status in ('pending','approved','rejected','expired')),
  proof_path   text,
  note         text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '48 hours',
  reviewed_by  uuid references profiles(id) on delete set null,
  reviewed_at  timestamptz
);
-- No two OPEN requests may share an exact amount — that is what lets a
-- bank-statement line identify one buyer.
create unique index if not exists payment_requests_open_amount_uidx
  on payment_requests (amount) where status = 'pending';
create index if not exists payment_requests_profile_idx on payment_requests (profile_id, created_at desc);
create index if not exists payment_requests_status_idx on payment_requests (status, created_at desc);

alter table payment_requests enable row level security;
drop policy if exists payment_requests_read_own on payment_requests;
create policy payment_requests_read_own on payment_requests
  for select using (profile_id = (select auth.uid()) or (select my_role())::text = 'superadmin');
-- (no insert/update/delete policies on purpose — RPCs below only)

-- ── 4. private bucket for transfer proofs ────────────────────────────
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

-- Path: "<profile_id>/<uuid>.<ext>". Owner can add + view their own;
-- superadmin can view everything. No owner update/delete.
drop policy if exists payment_proofs_owner_insert on storage.objects;
create policy payment_proofs_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists payment_proofs_read on storage.objects;
create policy payment_proofs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select my_role())::text = 'superadmin'));

-- ── 5. RPCs ──────────────────────────────────────────────────────────
create or replace function request_payment(p_plan text, p_months int)
returns payment_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_prof  profiles%rowtype;
  v_price bigint;
  v_row   payment_requests;
  v_code  int;
  v_tries int := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_prof from profiles where id = v_uid;
  if not found or v_prof.role <> 'branch_manager' then
    raise exception 'only Owner accounts can buy a plan';
  end if;
  if v_prof.plan_type = 'prof' then
    raise exception 'this account is billed separately';
  end if;
  if p_months not in (1, 3, 6, 12) then raise exception 'invalid duration'; end if;
  select price_per_month into v_price from billing_plans where plan_type = p_plan and active;
  if v_price is null then raise exception 'plan not available'; end if;

  -- lazily expire stale open requests so their amounts free up
  update payment_requests set status = 'expired'
   where status = 'pending' and expires_at < now();

  -- one open request per account: hand back the existing one
  select * into v_row from payment_requests where profile_id = v_uid and status = 'pending' limit 1;
  if found then return v_row; end if;

  loop
    v_tries := v_tries + 1;
    v_code := 1 + floor(random() * 99)::int;
    begin
      insert into payment_requests (profile_id, client_id, plan_type, months, base_amount, unique_code, amount)
      values (v_uid, v_prof.client_id, p_plan, p_months, v_price * p_months, v_code, v_price * p_months + v_code)
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      if v_tries >= 150 then raise exception 'too many open payment requests, try again in a few minutes'; end if;
    end;
  end loop;
end $$;

create or replace function attach_payment_proof(p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_path not like auth.uid()::text || '/%' then
    raise exception 'invalid proof path';
  end if;
  update payment_requests set proof_path = p_path
   where id = p_id and profile_id = auth.uid() and status = 'pending';
  if not found then raise exception 'no open request to attach this proof to'; end if;
end $$;

create or replace function cancel_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update payment_requests set status = 'expired'
   where id = p_id and profile_id = auth.uid() and status = 'pending';
end $$;

-- Approving extends from the CURRENT end date when the buyer is renewing
-- the same plan and it hasn't lapsed yet (no lost days on early renewal);
-- otherwise it starts now. Switching plans (e.g. a Sultan trial -> calc)
-- starts now — the other plan's leftover days are not carried over.
create or replace function approve_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r payment_requests;
  p profiles;
  v_start timestamptz;
begin
  if my_role()::text <> 'superadmin' then raise exception 'not allowed'; end if;
  select * into r from payment_requests where id = p_id for update;
  if not found or r.status not in ('pending', 'expired') then
    raise exception 'request not found or already reviewed';
  end if;
  select * into p from profiles where id = r.profile_id for update;
  v_start := case
    when p.plan_type = r.plan_type and p.subscription_end is not null and p.subscription_end > now()
      then p.subscription_end
    else now() end;
  update profiles
     set plan_type = r.plan_type,
         subscription_end = v_start + make_interval(months => r.months)
   where id = r.profile_id;
  update payment_requests
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
end $$;

create or replace function reject_payment(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role()::text <> 'superadmin' then raise exception 'not allowed'; end if;
  update payment_requests
     set status = 'rejected', note = p_note, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and status in ('pending', 'expired');
  if not found then raise exception 'request not found or already reviewed'; end if;
end $$;

-- ── 6. calculator fee data readable by every signed-in account ───────
-- market_fees is the fee table Prof Toko Online maintains; it was only
-- readable by its own tenant, so a customer who signed up on their own
-- (their own empty tenant) would buy the Price Calculator and find no
-- fee data in it. Read-only: writes stay superadmin/client_admin of the
-- owning tenant (0115). Hardcoded to Prof Toko Online's client_id, same
-- value the ERP endpoint defaults to.
drop policy if exists market_fees_read_master on market_fees;
create policy market_fees_read_master on market_fees
  for select to authenticated
  using (client_id = '92213048-a91b-4202-9b47-8d1c38671082'::uuid);

-- ── 7. an expired Owner can no longer add/edit calculator items ──────
-- (until now only the UI showed a "read-only" banner on expiry — for a
-- plan that IS the calculator, that would have made renewing optional)
drop policy if exists price_calc_items_write on price_calc_items;
create policy price_calc_items_write on price_calc_items
  for all
  using (
    (select my_role())::text = 'superadmin'
    or (
      client_id = (select my_client_id())
      and (
        (select my_role())::text = 'client_admin'
        or ((select my_role())::text = 'branch_manager' and owner = (select my_scope_owner()) and (select my_sub_active()))
      )
    )
  )
  with check (
    (select my_role())::text = 'superadmin'
    or (
      client_id = (select my_client_id())
      and (
        (select my_role())::text = 'client_admin'
        or ((select my_role())::text = 'branch_manager' and owner = (select my_scope_owner()) and (select my_sub_active()))
      )
    )
  );

notify pgrst, 'reload config';
