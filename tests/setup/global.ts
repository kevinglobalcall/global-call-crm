/**
 * 測試開波前：用**真 migration** 砌一個 template database（gc_template）。
 * 每個測試檔由佢 clone 一個自己嘅 DB（tests/helpers/db.ts），互不干擾。
 *
 * ❗冇 TEST_DATABASE_URL 就即刻紅，唔靜靜雞跳過 —— 跳過咗嘅 test 等於冇測。
 * ❗測試個 schema 就係 production 個 schema（同一個 migration runner），唔係憑印象打嘅假 schema。
 */
import { connect } from "../../src/db/client.js";
import { migrate } from "../../src/db/migrate.js";

export const TEMPLATE_DB = "gc_template";

export default async function setup(): Promise<void> {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) {
    throw new Error(
      "要設 TEST_DATABASE_URL（一個有權開 database 嘅 Postgres，例如 postgresql://postgres@127.0.0.1:55432/postgres）",
    );
  }
  const root = connect(admin, { max: 1 });
  try {
    // 之前爆咗冇清嘅測試 DB 一齊清走
    const stale = await root<{ datname: string }[]>`select datname from pg_database where datname like 'gc_t_%'`;
    for (const { datname } of stale) await root.unsafe(`drop database if exists "${datname}" with (force)`);
    await root.unsafe(`drop database if exists ${TEMPLATE_DB}`);
    await root.unsafe(`create database ${TEMPLATE_DB}`);
  } finally {
    await root.end();
  }
  const u = new URL(admin);
  u.pathname = `/${TEMPLATE_DB}`;
  const tpl = connect(u.toString(), { max: 1 });
  try {
    await migrate(tpl, undefined, () => {});
  } finally {
    await tpl.end(); // ❗template 有人連住就 clone 唔到
  }
}
