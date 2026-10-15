/**
 * 本機示範資料（虛構公司）—— 淨係畀本機睇版面／截圖用，永遠唔好對 production 行。
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55432/gcdev node --import tsx scripts/dev-seed.ts
 */
import { connect, readDatabaseUrl } from "../src/db/client.js";
import { createCompany, phonesFromText } from "../src/domain/companies.js";
import { logCall } from "../src/domain/calls.js";
import { createAppointment } from "../src/domain/appointments.js";

const url = readDatabaseUrl();
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("dev-seed 淨係行本機 DB");
const sql = connect(url, { max: 1 });
const rows: [string, string, string, string, string][] = [
  ["示範甲工程有限公司", "Demo Kap Engineering Ltd", "2345 6789", "觀塘道 388 號 10 樓 A 室", "工程"],
  ["示範乙物流", "Demo Yuet Logistics", "3111 2222", "葵涌貨櫃碼頭路 8 號 3 樓", "物流"],
  ["示範丙設計工作室", "Demo Bing Design Studio", "2800 1234", "灣仔軒尼詩道 200 號 15 樓", "設計"],
  ["示範丁貿易", "Demo Ding Trading Co.", "2730 5566", "尖沙咀廣東道 30 號 8 樓", "貿易"],
  ["示範戊會計師事務所", "Demo Mou CPA", "2525 8899", "中環德輔道中 100 號 20 樓", "會計"],
  ["示範己餐飲集團", "Demo Gei F&B Group", "2388 7766", "旺角彌敦道 600 號 5 樓", "餐飲"],
];
const ids: string[] = [];
for (const [zh, en, ph, addr, ind] of rows) {
  const r = await createCompany(sql, { name_zh: zh, name_en: en, phones: phonesFromText(ph).ok, address_zh: addr, industry: ind, emails: [`info@${en.split(" ")[1]!.toLowerCase()}.example`] }, { force: true });
  ids.push(r.created!.id);
}
const now = new Date();
const at = (h: number, m = 0, d = 0) => { const x = new Date(now); x.setUTCDate(x.getUTCDate() + d); x.setUTCHours(h - 8, m, 0, 0); return x; };
await logCall(sql, { companyId: ids[0]!, outcome: "需要跟進", reachedR: true, dProvider: "CSL", dContractEnd: "2026-12-31", dPrice: "$198 × 15", content: "IT 經理陳生，15 條 SIM，年尾到期" });
await logCall(sql, { companyId: ids[1]!, outcome: "幾點鐘再打", callbackAt: at(16, 30), content: "前台話老闆 4 點半返" });
await logCall(sql, { companyId: ids[2]!, outcome: "沒有人接" });
await logCall(sql, { companyId: ids[3]!, outcome: "只接受電郵", content: "叫寄資料去 info" });
await logCall(sql, { companyId: ids[4]!, outcome: "不需要" });
await createAppointment(sql, { companyId: ids[0]!, startsAt: at(15, 0), newContact: { name: "陳生", title: "IT 經理" }, purpose: "介紹 SME Bundle" });
await createAppointment(sql, { companyId: ids[5]!, startsAt: at(11, 0, 2), newContact: { name: "李小姐", title: "營運經理" }, purpose: "CloudPhone 示範" });
console.log(`示範資料：${ids.length} 間公司`);
await sql.end();
