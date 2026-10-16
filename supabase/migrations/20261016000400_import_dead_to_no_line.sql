-- 名單匯入嗰陣標咗「不需要」嘅 dead／phone dead → 改做「唔通」
-- Kevin 2026-10-16：「cut line 不需要 / dead 唔通」（匯入嗰陣未有「唔通」狀態，先標住不需要）
--
-- 淨係郁三樣夾晒嘅：而家仲係「不需要」＋ 名單匯入嗰條備註有 dead（cut line 唔郁）＋ 匯入之後冇打過電話。
-- Kevin 自己打過／改過嘅唔掂。每間改咗都入 audit_log。
-- \y ＝ Postgres regex 嘅字邊界（SQL 檔入面寫得，唔經 JS template）。

with target as (
  select c.id
    from public.companies c
   where c.status = '不需要'
     and not exists (select 1 from public.calls k where k.company_id = c.id)
     and exists (select 1 from public.company_remarks r
                  where r.company_id = c.id and r.source = 'import' and lower(r.body) ~ '\ydead\y')
), upd as (
  update public.companies c set status = '唔通'
    from target t where c.id = t.id
  returning c.id, c.code
)
insert into public.audit_log (actor, action, table_name, record_id, before, after)
select 'migration', 'update_company', 'companies', upd.id::text,
       jsonb_build_object('status', '不需要'),
       jsonb_build_object('status', '唔通', 'why', 'Kevin 2026-10-16「dead 唔通」：名單匯入嘅 dead 由不需要改做唔通')
  from upd;
