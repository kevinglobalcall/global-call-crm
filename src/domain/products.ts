/**
 * 產品清單：客對乜有興趣（公司頁剔），之後第三期報價、第四期 GP 都用返佢。
 *
 * ❗價錢／成本／GP 計法未有就留空，唔估（Kevin 話之後畀）。
 * ❗產品唔准剷，淨係可以「停用」：舊公司剔過嘅興趣、舊報價都要搵得返個名。
 */

import { one, toJson, type Sql } from "../db/client.js";
import { blankToNull } from "../lib/text.js";

export interface ProductRow {
  id: string;
  name: string;
  category: string | null;
  active: boolean;
  sort: number;
  default_monthly_fee: string | null;
  default_cost: string | null;
  default_term_months: number | null;
  notes: string | null;
  interested: number;
}

export async function listProducts(sql: Sql, opts: { includeInactive?: boolean } = {}): Promise<ProductRow[]> {
  return sql<ProductRow[]>`
    select p.id, p.name, p.category, p.active, p.sort,
           p.default_monthly_fee::text, p.default_cost::text, p.default_term_months, p.notes,
           (select count(*)::int from public.company_products cp where cp.product_id = p.id) as interested
      from public.products p
     where ${opts.includeInactive ? sql`true` : sql`p.active`}
     order by p.active desc, p.sort, p.name`;
}

export interface ProductInput {
  name?: string;
  category?: string | null;
  active?: boolean;
  sort?: number;
  default_monthly_fee?: number | string | null;
  default_cost?: number | string | null;
  default_term_months?: number | string | null;
  notes?: string | null;
}

/** 金額欄：空 ＝ 未有（null），唔係 0。打咗 0 就係 0。 */
function money(v: unknown, what: string): string | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const t = String(v).replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new Error(`${what}「${String(v)}」唔係金額`);
  return t;
}

function months(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 120) throw new Error(`期數「${String(v)}」要係 1–120 個月`);
  return n;
}

function setOf(p: ProductInput): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (p.name !== undefined) {
    const n = blankToNull(p.name);
    if (!n) throw new Error("產品要有名");
    set.name = n;
  }
  if (p.category !== undefined) set.category = blankToNull(p.category);
  if (p.active !== undefined) set.active = Boolean(p.active);
  if (p.sort !== undefined) set.sort = Math.trunc(Number(p.sort) || 0);
  if (p.default_monthly_fee !== undefined) set.default_monthly_fee = money(p.default_monthly_fee, "月費");
  if (p.default_cost !== undefined) set.default_cost = money(p.default_cost, "成本");
  if (p.default_term_months !== undefined) set.default_term_months = months(p.default_term_months);
  if (p.notes !== undefined) set.notes = blankToNull(p.notes);
  return set;
}

async function nameTaken(sql: Sql, name: string, exceptId?: string): Promise<boolean> {
  const rows = await sql`select 1 from public.products
                          where public.nospace(name) = public.nospace(${name})
                            and id is distinct from ${exceptId ?? null}::uuid`;
  return rows.length > 0;
}

export async function createProduct(sql: Sql, p: ProductInput, actor = "web"): Promise<string> {
  const set = setOf(p);
  if (!set.name) throw new Error("產品要有名");
  if (await nameTaken(sql, String(set.name))) throw new Error(`已經有「${String(set.name)}」（空格大細楷唔同都當一樣）`);
  if (set.sort === undefined) {
    const [m] = await sql<{ s: number }[]>`select coalesce(max(sort), 0) + 1 as s from public.products`;
    set.sort = m!.s;
  }
  return sql.begin(async (tx) => {
    const row = one(await tx<{ id: string }[]>`insert into public.products ${tx(set)} returning id`, "新產品");
    await tx`insert into public.audit_log (actor, action, table_name, record_id, after)
             values (${actor}, 'create_product', 'products', ${row.id}, ${tx.json(toJson(set))})`;
    return row.id;
  });
}

export async function updateProduct(sql: Sql, id: string, p: ProductInput, actor = "web"): Promise<void> {
  const set = setOf(p);
  if (!Object.keys(set).length) return;
  if (set.name && (await nameTaken(sql, String(set.name), id))) throw new Error(`已經有「${String(set.name)}」`);
  await sql.begin(async (tx) => {
    const [before] = await tx`select * from public.products where id = ${id} for update`;
    if (!before) throw new Error("搵唔到呢個產品");
    await tx`update public.products set ${tx(set)} where id = ${id}`;
    await tx`insert into public.audit_log (actor, action, table_name, record_id, before, after)
             values (${actor}, 'update_product', 'products', ${id}, ${tx.json(toJson(before))}, ${tx.json(toJson(set))})`;
  });
}
