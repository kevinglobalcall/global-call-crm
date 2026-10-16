/**
 * 網頁：開真 DOM（jsdom）行真 app.js，撳真掣，驗**送咗乜上 server**。
 * 淨係驗「粒掣喺度」唔算數 —— 每條都要驗一格由 fixture 嚟嘅真資料，證明 fixture 有入到。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const PUB = join(import.meta.dirname, "..", "public");
const HTML = readFileSync(join(PUB, "index.html"), "utf8");
const JS = readFileSync(join(PUB, "app.js"), "utf8");

const OUTCOME_RULES = [
  ["沒有人接", false, null, "optional", null], ["不需要", true, null, "none", "不需要"],
  ["稍後再撥打", true, "回撥", "optional", null], ["需要跟進", true, "跟進", "optional", null],
  ["只接受電郵", true, "寄電郵", "optional", null], ["已電郵", true, null, "optional", null],
  ["其他人跟進", true, null, "none", "其他人跟進"], ["幾點鐘再打", true, "回撥", "required", null],
  ["留聯絡", true, null, "optional", null],
] as const;

const META = {
  today: "2026-10-14",
  outcomes: OUTCOME_RULES.map(([outcome, connected, task, time, status]) => ({ outcome, connected, task, time, status, hint: `${outcome}嘅說明` })),
  statuses: ["未打", "跟進中", "不需要", "其他人跟進", "已成交", "已結業"],
  products: [{ id: "11111111-1111-1111-1111-111111111111", name: "SME Bundle — Business Connect" },
             { id: "22222222-2222-2222-2222-222222222222", name: "NB-IoT／工業 SIM" }],
  industries: [{ industry: "物流", n: 12 }],
};

type Call = { url: string; method: string; body: unknown };
type Route = (url: URL, body: unknown) => unknown;

async function boot(hash: string, routes: Record<string, Route | unknown>) {
  const calls: Call[] = [];
  const dom = new JSDOM(HTML.replace('<script src="/app/app.js"></script>', ""), {
    url: `http://localhost/app${hash}`, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      (w as unknown as { confirm: () => boolean }).confirm = () => true;
      (w as unknown as { scrollTo: () => void }).scrollTo = () => {};
      (w as unknown as { fetch: unknown }).fetch = async (u: string, init: { method?: string; body?: unknown } = {}) => {
        const url = new URL(u, "http://localhost");
        let body: unknown = init.body;
        if (typeof body === "string") { try { body = JSON.parse(body); } catch { /* raw */ } }
        calls.push({ url: url.pathname + url.search, method: init.method ?? "GET", body });
        const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => url.pathname === `/app/api${k}` || url.pathname.startsWith(`/app/api${k}`));
        const r = key === undefined ? { error: `fixture 冇 ${url.pathname}` } : routes[key];
        const out = typeof r === "function" ? (r as Route)(url, body) : r;
        const status = key === undefined ? 404 : 200;
        return { ok: status === 200, status, json: async () => JSON.parse(JSON.stringify(out)) };
      };
    },
  });
  const w = dom.window;
  const s = w.document.createElement("script");
  s.textContent = JS;
  w.document.body.appendChild(s);
  const gc = (w as unknown as { GC: { ready: Promise<void>; render: () => Promise<void> } }).GC;
  await gc.ready;
  return { w, d: w.document, calls, gc, posts: () => calls.filter((c) => c.method === "POST") };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const click = (el: Element | null) => { expect(el).toBeTruthy(); (el as HTMLElement).click(); };

// ── 今日 ─────────────────────────────────────────────────────────────────

const TODAY = {
  today: "2026-10-14",
  stats: { day: "2026-10-14", calls: 37, connected: 21, r: 6, d: 2, booked: 3, met: 1 },
  history: [{ day: "2026-10-14", calls: 37, connected: 21, r: 6, d: 2, booked: 3, met: 1 },
            { day: "2026-10-13", calls: 40, connected: 18, r: 4, d: 1, booked: 0, met: 2 }],
  due: [{
    id: "aaaaaaaa-0000-0000-0000-000000000001", company_id: "cccccccc-0000-0000-0000-000000000001", company_code: "GC-00012",
    company_name: "大發物流有限公司", phones: "23456789 / 91234567", kind: "回撥",
    due_at: "2026-10-13T07:00:00.000Z", note: "IT 經理 Peter", overdue: true, created_at: "2026-10-10T02:00:00.000Z",
  }],
  upcoming: [],
  appointments: [] as unknown[],
  renewals: [] as unknown[],
};

describe("今日", () => {
  it("出今日四個數（由 server 嚟）、日期連星期、過咗期嘅回撥標紅、電話撳得打", async () => {
    const { d } = await boot("#/", { "/meta": META, "/today": TODAY });
    expect(d.querySelector("h1")!.textContent).toBe("今日 10/14（三）");
    expect(d.querySelector('[data-k="calls"]')!.textContent).toBe("37");
    expect(d.querySelector('[data-k="r"]')!.textContent).toBe("6");
    expect(d.querySelector('[data-k="d"]')!.textContent).toBe("2");
    expect(d.body.textContent).toContain("接通（57%）");
    const row = d.querySelector('[data-task]')!;
    expect(row.textContent).toContain("大發物流有限公司");
    expect(row.querySelector(".overdue")!.textContent).toBe("過咗期 10/13（二）15:00");
    expect([...row.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute("href"))).toEqual(["tel:+85223456789", "tel:+85291234567"]);
  });

  it("撳「完成」→ POST 去嗰個待辦；撳「改時間」→ 送香港時間", async () => {
    const { d, posts } = await boot("#/", { "/meta": META, "/today": TODAY, "/tasks": { ok: true } });
    click(d.querySelector('[data-act="done"]'));
    await tick();
    expect(posts()[0]).toMatchObject({ url: "/app/api/tasks/aaaaaaaa-0000-0000-0000-000000000001/done" });
    click(d.querySelector('[data-act="move"]'));
    (d.querySelector(".move input") as HTMLInputElement).value = "2026-10-16T11:30";
    click(d.querySelector('[data-act="move-save"]'));
    await tick();
    expect(posts()[1]).toMatchObject({ url: "/app/api/tasks/aaaaaaaa-0000-0000-0000-000000000001/reschedule", body: { dueAt: "2026-10-16T11:30" } });
  });
});

// ── 公司頁：記電話 ─────────────────────────────────────────────────────────

const CID = "cccccccc-0000-0000-0000-000000000001";
function companyFixture(over: Record<string, unknown> = {}) {
  return {
    company: {
      id: CID, code: "GC-00012", name_zh: "大發物流有限公司", name_en: "Tai Fat Logistics Ltd", status: "跟進中",
      industry: "物流", customer_type: "公司", ever_r: false, ever_d: false, mis_checked: false, followed_by: null,
      address_zh: "觀塘道 1 號", address_en: null, br_no: null, website: null, notes: null, source: "list.csv", call_count: 2,
      ...over,
    },
    phones: [{ id: "p1", phone: "23456789", label: "總機" }, { id: "p2", phone: "23456790", label: "傳真" }],
    emails: [{ id: "e1", email: "info@taifat.hk" }],
    contacts: [], products: [{ id: "11111111-1111-1111-1111-111111111111", name: "SME Bundle — Business Connect" }],
    calls: [{
      id: "kkkkkkkk-0000-0000-0000-000000000001", called_at: "2026-10-13T02:00:00.000Z", attempt_no: 2, outcome: "沒有人接",
      reached_r: false, got_d: false, content: "冇人聽", callback_at: null, d_contract_end: null, d_provider: null, d_price: null, d_plan: null,
    }],
    tasks: [], nextAttempt: 3,
    remarks: [
      { id: "rrrrrrrr-0000-0000-0000-000000000001", body: "前台話 Leo 放假", author: "Kevin", source: "web", created_at: "2026-10-14T03:00:00.000Z" },
      { id: "rrrrrrrr-0000-0000-0000-000000000002", body: "no need, emailed", author: "名單匯入", source: "import", created_at: "2026-10-16T09:00:00.000Z" },
    ],
  };
}

async function companyPage(over: Record<string, unknown> = {}) {
  return boot(`#/c/${CID}`, {
    "/meta": META, [`/companies/${CID}`]: companyFixture(over),
    "/calls": { call: { attempt_no: 3, outcome: "x" }, statusBefore: "跟進中", statusAfter: "跟進中", closedTasks: 1, task: null },
  });
}

describe("公司頁：備註記錄（Remark Record）", () => {
  it("備註同電話合埋一條時間線，最新喺頂；名單匯入嗰條排最底、寫明原日期不明", async () => {
    const { d } = await companyPage();
    const rows = [...d.querySelectorAll("#timeline .remark, #timeline .call")];
    expect(rows.map((r) => r.getAttribute("data-remark") ?? r.getAttribute("data-call"))).toEqual([
      "rrrrrrrr-0000-0000-0000-000000000001", // 10/14 備註
      "kkkkkkkk-0000-0000-0000-000000000001", // 10/13 電話
      "rrrrrrrr-0000-0000-0000-000000000002", // 匯入：created_at 雖然最新，但冇真日期 → 最底
    ]);
    expect(rows[0]!.textContent).toContain("10/14（三）11:00");
    expect(rows[2]!.textContent).toContain("名單匯入（原日期不明）");
    expect(rows[2]!.textContent).not.toMatch(/10\/16/);
  });

  it("冇字唔撳得；寫咗就 POST 去嗰間公司", async () => {
    const { d, posts } = await companyPage();
    const box = d.querySelector("#rmBody") as HTMLTextAreaElement, btn = d.querySelector("#rmSave") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    box.value = "a women pick up, dunno leo";
    box.dispatchEvent(new d.defaultView!.Event("input"));
    expect(btn.disabled).toBe(false);
    click(btn);
    expect(posts().at(-1)).toMatchObject({ url: `/app/api/companies/${CID}/remarks`, body: { body: "a women pick up, dunno leo" } });
  });
});

describe("公司頁：記電話", () => {
  it("資料由 server 嚟；傳真唔做撥號連結；第幾次預填 ＝ 打過幾次 +1", async () => {
    const { d } = await companyPage();
    expect(d.querySelector("h1")!.textContent).toBe("大發物流有限公司");
    expect([...d.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute("href"))).toEqual(["tel:+85223456789"]);
    // 手機一撳就打：撥號連結係大粒掣，顯示返號碼
    expect([...d.querySelectorAll("a.dial")].map((a) => a.textContent!.trim())).toEqual(["2345 6789"]);
    expect(d.body.textContent).toContain("傳真 2345 6790");
    expect((d.querySelector("#attempt") as HTMLInputElement).value).toBe("3");
    expect(d.querySelectorAll("[data-outcome]").length).toBe(9);
    expect([...d.querySelectorAll("[data-outcome]")].map((b) => b.textContent)).toEqual(OUTCOME_RULES.map((r) => r[0]));
    expect((d.querySelector("#save") as HTMLButtonElement).disabled).toBe(true);
    // 興趣產品：server 話有嗰隻亮咗
    expect(d.querySelector('[data-p="11111111-1111-1111-1111-111111111111"]')!.classList.contains("on")).toBe(true);
  });

  it("❗「幾點鐘再打」唔揀時間 → 唔送；揀「聽日 15:00」→ 送香港時間；填 D 資料自動剔 D", async () => {
    const { d, posts } = await companyPage();
    click(d.querySelector('[data-outcome="幾點鐘再打"]'));
    expect((d.querySelector("#timebox") as HTMLElement).hidden).toBe(false);
    expect(d.querySelector("#timelabel")!.textContent).toContain("一定要揀");
    click(d.querySelector("#save"));
    await tick();
    expect(posts().length).toBe(0);
    expect(d.querySelector("#callerr")!.textContent).toBe("「幾點鐘再打」一定要揀時間");

    click(d.querySelector('[data-time="2026-10-15T15:00"]'));
    expect((d.querySelector("#callback") as HTMLInputElement).value).toBe("2026-10-15T15:00");
    (d.querySelector("#isR") as HTMLInputElement).click();
    const prov = d.querySelector("#dProvider") as HTMLInputElement;
    prov.value = "CSL";
    prov.dispatchEvent(new d.defaultView!.Event("input"));
    expect((d.querySelector("#isD") as HTMLInputElement).checked).toBe(true);
    (d.querySelector("#content") as HTMLTextAreaElement).value = "IT 經理 Peter";
    click(d.querySelector("#save"));
    await tick();
    expect(posts()[0]!.url).toBe("/app/api/calls");
    expect(posts()[0]!.body).toEqual({
      companyId: CID, outcome: "幾點鐘再打", attemptNo: 3, callbackAt: "2026-10-15T15:00", content: "IT 經理 Peter",
      reachedR: true, gotD: true, dContractEnd: null, dProvider: "CSL", dPrice: null, dPlan: null,
      otherFollower: null, phoneDialed: "23456789",
    });
  });

  it("「不需要」：冇時間格；之前揀過嘅時間都唔會送", async () => {
    const { d, posts } = await companyPage();
    click(d.querySelector('[data-outcome="稍後再撥打"]'));
    click(d.querySelector('[data-time="2026-10-15T10:00"]'));
    click(d.querySelector('[data-outcome="不需要"]'));
    expect((d.querySelector("#timebox") as HTMLElement).hidden).toBe(true);
    click(d.querySelector("#save"));
    await tick();
    expect(posts()[0]!.body).toMatchObject({ outcome: "不需要", callbackAt: null });
  });

  it("「其他人跟進」一定要填同事；填咗先送", async () => {
    const { d, posts } = await companyPage();
    click(d.querySelector('[data-outcome="其他人跟進"]'));
    expect((d.querySelector("#otherbox") as HTMLElement).hidden).toBe(false);
    click(d.querySelector("#save"));
    await tick();
    expect(posts().length).toBe(0);
    (d.querySelector("#other") as HTMLInputElement).value = "阿明";
    click(d.querySelector("#save"));
    await tick();
    expect(posts()[0]!.body).toMatchObject({ outcome: "其他人跟進", otherFollower: "阿明", callbackAt: null });
  });

  it("手改第幾次照送；「沒有人接」唔揀時間 ＝ callbackAt null", async () => {
    const { d, posts } = await companyPage();
    (d.querySelector("#attempt") as HTMLInputElement).value = "7";
    click(d.querySelector('[data-outcome="沒有人接"]'));
    click(d.querySelector("#save"));
    await tick();
    expect(posts()[0]!.body).toMatchObject({ outcome: "沒有人接", attemptNo: 7, callbackAt: null, reachedR: false, gotD: false });
  });

  it("撳產品 → 送晒全部已揀（唔係淨係撳嗰隻）；MIS 剔 → 送 mis_checked", async () => {
    const { d, posts } = await companyPage();
    click(d.querySelector('[data-p="22222222-2222-2222-2222-222222222222"]'));
    await tick();
    expect(posts()[0]).toMatchObject({
      url: `/app/api/companies/${CID}`,
      body: { productIds: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"] },
    });
    const mis = d.querySelector("#mis") as HTMLInputElement;
    mis.click();
    await tick();
    expect(posts()[1]!.body).toEqual({ mis_checked: true });
  });

  it("未完成待辦：唔再出「冇電話」同公司名（公司頁本身已經有）", async () => {
    const fx = companyFixture();
    const { d } = await boot(`#/c/${CID}`, { "/meta": META, [`/companies/${CID}`]: {
      ...fx, tasks: [{ id: "tttttttt-0000-0000-0000-000000000001", kind: "回撥", due_at: "2026-10-15T07:00:00.000Z", status: "待辦", note: "問 Peter" }],
    } });
    const row = d.querySelector("[data-task]")!;
    expect(row.textContent).toContain("10/15（四）15:00");
    expect(row.textContent).toContain("問 Peter");
    expect(row.textContent).not.toContain("冇電話");
    expect((row.querySelector(".move") as HTMLElement).hidden).toBe(true);
  });

  it("中英文名一樣（大細楷空格唔同）唔出兩次", async () => {
    const { d } = await companyPage({ name_zh: "ABC Trading Ltd", name_en: "abc  trading ltd" });
    expect(d.querySelector("h1")!.textContent).toBe("ABC Trading Ltd");
    expect(d.querySelector("h1")!.parentElement!.querySelector(".muted")).toBeNull();
  });

  it("❗CSS：[hidden] 一定要贏 .btn／.row 嘅 display（真瀏覽器撞過：載多啲、改時間格一直出）", () => {
    const css = readFileSync(join(PUB, "app.css"), "utf8");
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it("❗公司名有 HTML 都當字出，唔會變咗元素", async () => {
    const { d } = await companyPage({ name_zh: '<img src=x onerror="alert(1)">壞名' });
    expect(d.querySelector("h1 img")).toBeNull();
    expect(d.querySelector("h1")!.textContent).toBe('<img src=x onerror="alert(1)">壞名');
  });

  it("改公司資料：電話格預填返傳真標籤（存返唔會變咗總機）", async () => {
    const { d } = await companyPage();
    expect((d.querySelector('[data-c="phonesText"]') as HTMLInputElement).value).toBe("2345 6789 / 傳真 2345 6790");
  });
});

// ── 公司清單 ───────────────────────────────────────────────────────────────

describe("公司清單", () => {
  const LIST = {
    total: 132, totalR: 17, totalD: 5,
    rows: [{ id: CID, code: "GC-00012", name_zh: "大發物流有限公司", name_en: null, status: "跟進中", ever_r: true, ever_d: false,
      industry: "物流", call_count: 2, last_outcome: "需要跟進", last_call_at: "2026-10-13T02:00:00.000Z", d_contract_end: null,
      d_provider: null, followed_by: null, mis_checked: true }],
  };

  it("出「共幾多間 · R · D」；篩 R＝有 → 請求同導出連結都帶 r=yes", async () => {
    const { d, calls } = await boot("#/companies", { "/meta": META, "/companies": LIST });
    await tick();
    expect(d.querySelector("#summary")!.textContent).toBe("共 132 間 · R 17 間 · D 5 間");
    expect(d.querySelector("#list")!.textContent).toContain("大發物流有限公司");
    const r = d.querySelector('[data-f="r"]') as HTMLSelectElement;
    r.value = "yes";
    r.dispatchEvent(new d.defaultView!.Event("change"));
    await tick(5);
    const last = calls.filter((c) => c.url.startsWith("/app/api/companies?")).at(-1)!;
    expect(last.url).toContain("r=yes");
    expect(d.querySelector("#export")!.getAttribute("href")).toBe("/app/api/companies.xlsx?r=yes");
    expect(d.defaultView!.location.hash).toBe("#/companies?r=yes");
  });

  it("打字搜尋（等 300ms 先搵）；冷電名單剔咗帶 cold=1", async () => {
    const { d, calls } = await boot("#/companies", { "/meta": META, "/companies": LIST });
    const q = d.querySelector('[data-f="q"]') as HTMLInputElement;
    q.value = "大 發";
    q.dispatchEvent(new d.defaultView!.Event("input"));
    await tick(350);
    expect(calls.filter((c) => c.url.startsWith("/app/api/companies?")).at(-1)!.url).toContain("q=%E5%A4%A7+%E7%99%BC");
    (d.querySelector('[data-f="cold"]') as HTMLInputElement).click();
    await tick(5);
    expect(calls.filter((c) => c.url.startsWith("/app/api/companies?")).at(-1)!.url).toContain("cold=1");
  });

  it("由網址還原篩選（返轉頭唔會清晒）", async () => {
    const { d, calls } = await boot("#/companies?d=yes&industry=%E7%89%A9%E6%B5%81", { "/meta": META, "/companies": LIST });
    await tick();
    expect((d.querySelector('[data-f="d"]') as HTMLSelectElement).value).toBe("yes");
    expect((d.querySelector('[data-f="industry"]') as HTMLSelectElement).value).toBe("物流");
    expect(calls.find((c) => c.url.startsWith("/app/api/companies?"))!.url).toContain("d=yes");
  });
});

describe("全站搜尋（頁頭，任何頁都有）", () => {
  const HIT = { total: 12, totalR: 0, totalD: 0, rows: [{ id: CID, code: "GC-00142", name_zh: "嘉華國際", name_en: null,
    status: "未打", phones: "28800178", emails: "", call_count: 0 }] };

  it("打字 → 等一陣先搵（帶 limit=8）→ 下拉出名、編號、電話；超過 8 間出「睇晒」；撳一間入公司頁", async () => {
    const { d, calls } = await boot("#/calendar", { "/meta": META, "/appointments": [], "/companies": HIT });
    const q = d.querySelector("#gq") as HTMLInputElement;
    q.value = "2880 0178";
    q.dispatchEvent(new d.defaultView!.Event("input"));
    await tick(300);
    expect(calls.filter((c) => c.url.startsWith("/app/api/companies?")).at(-1)!.url).toBe("/app/api/companies?q=2880%200178&limit=8");
    const box = d.querySelector("#gres") as HTMLElement;
    expect(box.hidden).toBe(false);
    const item = box.querySelector("a.gitem")!;
    expect(item.getAttribute("href")).toBe(`#/c/${CID}`);
    expect(item.textContent).toContain("嘉華國際");
    expect(item.textContent).toContain("GC-00142 · 2880 0178");
    expect(box.querySelector("a.gall")!.textContent).toBe("睇晒 12 間 →");
    click(item);
    expect(box.hidden).toBe(true);
    expect(q.value).toBe("");
  });

  it("Enter → 公司清單帶埋個字", async () => {
    const { d } = await boot("#/", { "/meta": META, "/today": TODAY, "/companies": HIT });
    const q = d.querySelector("#gq") as HTMLInputElement;
    q.value = "嘉華";
    q.dispatchEvent(new d.defaultView!.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(d.defaultView!.location.hash).toBe("#/companies?q=%E5%98%89%E8%8F%AF");
  });
});

describe("深淺色（Kevin 2026-10-16「web也要dark mode」）", () => {
  it("預設深色（一開頁未行 app.js 已經套用）；撳掣：深 → 淺 → 跟系統 → 深，記低喺呢部機", async () => {
    const { d, w } = await boot("#/", { "/meta": META, "/today": TODAY, "/tasks": { ok: true } });
    const html = d.documentElement;
    expect(html.getAttribute("data-theme")).toBe("dark");
    const btn = d.querySelector("#themeBtn") as HTMLButtonElement;
    expect(btn.textContent).toBe("深色");
    click(btn);
    expect([html.getAttribute("data-theme"), w.localStorage.getItem("gc-theme"), btn.textContent]).toEqual(["light", "light", "淺色"]);
    click(btn);
    // 跟系統 ＝ 唔寫 data-theme，由 CSS prefers-color-scheme 話事
    expect([html.hasAttribute("data-theme"), w.localStorage.getItem("gc-theme"), btn.textContent]).toEqual([false, "auto", "跟系統"]);
    click(btn);
    expect(html.getAttribute("data-theme")).toBe("dark");
  });

  it("❗CSS 真係有 [data-theme=dark] 嗰套色（唔係淨係跟系統）—— 唔係粒掣撳咗都冇用", () => {
    const css = readFileSync(join(PUB, "app.css"), "utf8");
    const block = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block).toMatch(/--bg:\s*#0a1428/);
    expect(block).toMatch(/--card:/);
    expect(block).toMatch(/color-scheme:\s*dark/);
  });
});

describe("撳個數睇係邊幾間（Kevin：要能夠點開顯示什麼公司）", () => {
  it("今日六格都係連結，帶 kind 同今日日子", async () => {
    const { d } = await boot("#/", { "/meta": META, "/today": TODAY, "/tasks": { ok: true } });
    const hrefs = [...d.querySelectorAll("a.stat")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["calls", "connected", "r", "d", "booked", "met"]
      .map((k) => `#/stats/detail?kind=${k}&from=${TODAY.today}&to=${TODAY.today}`));
    // data-k 照留（其他 test 同截圖腳本靠佢）
    expect(d.querySelector('a.stat [data-k="calls"]')).toBeTruthy();
  });

  it("detail 頁：每行連去間公司，出時間、第幾次、結果、內容", async () => {
    const DETAIL = { kind: "r", from: "2026-10-16", to: "2026-10-16", rows: [{
      company_id: CID, code: "GC-00012", name: "大發物流有限公司", at: "2026-10-16T03:30:00.000Z", tag: "需要跟進",
      attempt_no: 2, reached_r: true, got_d: true, text: "IT 經理陳生", extra: "CSL · 約滿 2027-03-31" }] };
    const { d, calls } = await boot("#/stats/detail?kind=r&from=2026-10-16&to=2026-10-16", { "/meta": META, "/stats/detail": DETAIL });
    await tick();
    expect(calls.find((c) => c.url.startsWith("/app/api/stats/detail"))!.url).toBe("/app/api/stats/detail?kind=r&from=2026-10-16&to=2026-10-16");
    expect(d.querySelector("h1")!.textContent).toBe("R 負責人：10/16（五）（1）");
    const a = d.querySelector("#detail a.item")!;
    expect(a.getAttribute("href")).toBe(`#/c/${CID}`);
    expect(a.textContent).toContain("10/16（五）11:30");
    expect(a.textContent).toContain("第 2 次");
    expect(a.textContent).toContain("IT 經理陳生");
    expect(a.textContent).toContain("D：CSL · 約滿 2027-03-31");
  });
});

describe("公司清單每行：直接打、記結果、改狀態、寫備註（Kevin 2026-10-16）", () => {
  const ROW = {
    id: CID, code: "GC-00012", name_zh: "大發物流有限公司", name_en: "Tai Fat Logistics Ltd", status: "未打", ever_r: false, ever_d: false,
    industry: "物流", call_count: 0, last_outcome: null, last_call_at: null, d_contract_end: null, d_provider: null,
    followed_by: null, mis_checked: false, phones: "23456789 / 23456790（傳真）", emails: "info@taifat.hk",
    last_note: { kind: "import", text: "no one answer, emailed", at: null, author: "名單匯入", outcome: null },
  };
  const LIST2 = { total: 1, totalR: 0, totalD: 0, rows: [ROW] };
  const CALLED = { call: { id: "kkkkkkkk-0000-0000-0000-000000000009", attempt_no: 1, outcome: "沒有人接" },
    statusBefore: "未打", statusAfter: "跟進中", closedTasks: 0, task: null };
  const page = () => boot("#/companies?cold=1", { "/meta": META, "/companies": LIST2, "/calls": CALLED, "/remarks": { ok: true } });
  const row = (d: Document) => d.querySelector(`[data-row="${CID}"]`)!;

  it("一行出齊：撥號掣（傳真唔撥）、電郵 mailto、狀態下拉、最新備註（匯入嗰條寫名單匯入）", async () => {
    const { d } = await page();
    await tick();
    const r = row(d);
    expect([...r.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute("href"))).toEqual(["tel:+85223456789"]);
    expect(r.textContent).toContain("傳真 2345 6790");
    expect(r.querySelector('a[href="mailto:info@taifat.hk"]')).toBeTruthy();
    expect((r.querySelector('[data-act="status"]') as HTMLSelectElement).value).toBe("未打");
    expect(r.querySelector(".lastnote")!.textContent).toBe("名單匯入 no one answer, emailed");
    expect(r.querySelectorAll('[data-act="out"]').length).toBe(9);
  });

  it("顯示所有備註（Kevin：顯示所有備註）：每條一行，電話出第幾次同結果", async () => {
    const withHist = { ...LIST2, rows: [{ ...ROW, history: [
      { kind: "remark", text: "enquire@kwcml.com", at: "2026-10-16T03:44:00.000Z", author: "Kevin", outcome: null, attempt_no: null },
      { kind: "call", text: null, at: "2026-10-16T03:35:00.000Z", author: null, outcome: "沒有人接", attempt_no: 1 },
      { kind: "remark", text: "28808224 mr.lau", at: "2026-10-16T03:30:00.000Z", author: "Kevin", outcome: null, attempt_no: null },
      { kind: "import", text: "no one answer, emailed", at: null, author: "名單匯入", outcome: null, attempt_no: null },
    ] }] };
    const { d } = await boot("#/companies?cold=1", { "/meta": META, "/companies": withHist });
    await tick();
    expect([...d.querySelectorAll(`[data-row="${CID}"] .lastnote .nline`)].map((x) => x.textContent)).toEqual([
      "10/16（五）11:44 · Kevin enquire@kwcml.com",
      "10/16（五）11:35 · 第 1 次 · 沒有人接",
      "10/16（五）11:30 · Kevin 28808224 mr.lau",
      "名單匯入 no one answer, emailed",
    ]);
  });

  it("顯示網址（Kevin：加顯示網址）：幾個網址拆開、開新分頁；javascript: 唔做連結", async () => {
    const withSite = { ...LIST2, rows: [{ ...ROW, website: "https://www.towngas.com | towngassmartenergy.com javascript:alert(1)" }] };
    const { d } = await boot("#/companies?cold=1", { "/meta": META, "/companies": withSite });
    await tick();
    const links = [...d.querySelectorAll(`[data-row="${CID}"] .site a`)];
    expect(links.map((a) => [a.getAttribute("href"), a.textContent, a.getAttribute("target")])).toEqual([
      ["https://www.towngas.com", "towngas.com", "_blank"],
      ["https://towngassmartenergy.com", "towngassmartenergy.com", "_blank"],
    ]);
    expect(d.querySelector(`[data-row="${CID}"] .site`)!.textContent).toContain("javascript:alert(1)");
    expect(d.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("撳「沒有人接」→ 即刻記電話：帶公司、第 1 次、格入面啲字做內容", async () => {
    const { d, posts } = await page();
    await tick();
    const r = row(d);
    (r.querySelector('[data-v="note"]') as HTMLTextAreaElement).value = "響咗十聲";
    click(r.querySelector('[data-o="沒有人接"]'));
    await tick(5);
    expect(posts().at(-1)).toMatchObject({ url: "/app/api/calls",
      body: { companyId: CID, outcome: "沒有人接", attemptNo: 1, content: "響咗十聲", phoneDialed: "23456789" } });
    // 記完重攞嗰一行（帶 id），唔係成版重載
    await tick(5);
    expect(row(d).querySelector(".qdone")!.textContent).toContain("記低咗：第 1 次 · 沒有人接");
    expect(row(d).querySelector('[data-act="undo"]')).toBeTruthy();
  });

  it("❗「幾點鐘再打」冇揀時間唔送；揀咗先送香港時間", async () => {
    const { d, posts } = await page();
    await tick();
    const r = row(d);
    click(r.querySelector('[data-o="幾點鐘再打"]'));
    expect(posts().length).toBe(0);
    click(r.querySelector('[data-act="out-time"]'));
    expect(posts().length).toBe(0);
    click(r.querySelector('[data-act="qtime"][data-time="2026-10-15T10:00"]'));
    click(r.querySelector('[data-act="out-time"]'));
    await tick(5);
    expect(posts().at(-1)).toMatchObject({ url: "/app/api/calls", body: { outcome: "幾點鐘再打", callbackAt: "2026-10-15T10:00" } });
  });

  it("❗「其他人跟進」唔填同事名唔送", async () => {
    const { d, posts } = await page();
    await tick();
    const r = row(d);
    click(r.querySelector('[data-o="其他人跟進"]'));
    click(r.querySelector('[data-act="out-other"]'));
    expect(posts().length).toBe(0);
    (r.querySelector('[data-v="other"]') as HTMLInputElement).value = "阿明";
    click(r.querySelector('[data-act="out-other"]'));
    await tick(5);
    expect(posts().at(-1)).toMatchObject({ body: { outcome: "其他人跟進", otherFollower: "阿明" } });
  });

  it("記完結果自動跳去下一間（Kevin：按完狀態後自動跳下一個）；加備註唔跳", async () => {
    const CID2 = "cccccccc-0000-0000-0000-000000000002";
    const two = { total: 2, totalR: 0, totalD: 0, rows: [ROW, { ...ROW, id: CID2, code: "GC-00013", name_zh: "第二間有限公司" }] };
    const { d } = await boot("#/companies?cold=1", { "/meta": META, "/companies": two, "/calls": CALLED, "/remarks": { ok: true } });
    await tick();
    const scrolled: string[] = [];
    (d.defaultView!.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.getAttribute("data-row") ?? "");
    };
    const first = d.querySelector(`[data-row="${CID}"]`)!;
    (first.querySelector('[data-v="note"]') as HTMLTextAreaElement).value = "x";
    click(first.querySelector('[data-act="note"]'));
    await tick(5);
    expect(scrolled).toEqual([]);
    click(d.querySelector(`[data-row="${CID}"] [data-o="不需要"]`));
    await tick(5);
    expect(scrolled).toEqual([CID2]);
    expect(d.querySelector(`[data-row="${CID2}"]`)!.classList.contains("nextup")).toBe(true);
  });

  it("刪除：問一次先送；刪咗嗰行寫已刪除、總數減 1", async () => {
    const { d, posts } = await boot("#/companies?cold=1", { "/meta": META, "/companies": (url: URL) =>
      url.pathname.endsWith("/delete") ? { deleted: { code: "GC-00012", name: "大發物流有限公司" } } : LIST2 });
    await tick();
    click(d.querySelector(`[data-row="${CID}"] [data-act="del-co"]`));
    await tick(5);
    expect(posts().at(-1)).toMatchObject({ url: `/app/api/companies/${CID}/delete` });
    expect(d.querySelector(`[data-row="${CID}"]`)!.textContent).toBe("已刪除 GC-00012 大發物流有限公司");
    expect(d.querySelector("#summary b")!.textContent).toBe("0");
  });

  it("加備註 POST 去嗰間；改狀態下拉即刻存", async () => {
    const { d, posts } = await page();
    await tick();
    const r = row(d);
    (r.querySelector('[data-v="note"]') as HTMLTextAreaElement).value = "Left phone number to reception";
    click(r.querySelector('[data-act="note"]'));
    await tick(5);
    expect(posts().at(-1)).toMatchObject({ url: `/app/api/companies/${CID}/remarks`, body: { body: "Left phone number to reception" } });
    const sel = row(d).querySelector('[data-act="status"]') as HTMLSelectElement;
    sel.value = "不需要";
    sel.dispatchEvent(new d.defaultView!.Event("change", { bubbles: true }));
    await tick(5);
    expect(posts().at(-1)).toMatchObject({ url: `/app/api/companies/${CID}`, body: { status: "不需要" } });
  });
});

// ── 匯入、新增 ─────────────────────────────────────────────────────────────

describe("匯入", () => {
  it("揀檔 → preview 出數同欄名對照 → 剔「照入」→ commit 帶 allowPhoneClash", async () => {
    const preview = {
      sheet: null, headers: ["中文名", "總機", "負責同事"], mapping: ["name_zh", "phone", null], unmapped: ["負責同事"],
      counts: { total: 5, new: 3, mergedInFile: 1, existingName: 1, existingPhone: 0, noName: 0 },
      sample: [{ line: 2, name_zh: "甲公司", name_en: null, phones: ["23456789"], emails: [], industry: null }],
      issues: [{ line: 4, action: "skip", reason: "已經有：GC-00001 乙公司", warnings: [], name: "乙公司" }], issuesTotal: 1,
    };
    const { d, w, posts } = await boot("#/import", {
      "/meta": META, "/import/preview": preview, "/import/commit": { created: 3, firstCode: "GC-00100", lastCode: "GC-00102" },
      "/companies": { total: 0, totalR: 0, totalD: 0, rows: [] },
    });
    const input = d.querySelector("#file") as HTMLInputElement;
    const file = new w.File(["中文名,總機\n甲公司,23456789\n"], "名單.csv", { type: "text/csv" });
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new w.Event("change"));
    await tick(5);
    expect(posts()[0]!.url).toBe("/app/api/import/preview?filename=%E5%90%8D%E5%96%AE.csv");
    expect(d.querySelector('[data-k="new"]')!.textContent).toBe("3");
    expect(d.querySelector("#preview")!.textContent).toContain("（寫落備註）");
    (d.querySelector("#clash") as HTMLInputElement).click();
    await tick(5);
    click(d.querySelector("#commit"));
    await tick(5);
    expect(posts().at(-1)!.url).toBe("/app/api/import/commit?filename=%E5%90%8D%E5%96%AE.csv&allowPhoneClash=1");
  });
});

describe("新增公司", () => {
  it("撞咗現有公司 → 出邊間撞；撳「照開」先 force", async () => {
    const { d, w, posts } = await boot("#/new", {
      "/meta": META,
      [`/companies/${CID}`]: companyFixture(),
      "/companies": (_u: URL, body: unknown) => {
        return (body as { force: boolean }).force
          ? { created: { id: CID, code: "GC-00099" }, duplicates: [] }
          : { created: null, duplicates: [{ id: CID, code: "GC-00012", name: "大發物流有限公司", why: "電話 23456789 一樣" }] };
      },
    });
    (d.querySelector('[data-c="name_zh"]') as HTMLInputElement).value = "大發運輸";
    (d.querySelector('[data-c="phonesText"]') as HTMLInputElement).value = "2345 6789";
    click(d.querySelector("#create"));
    await tick(5);
    expect(posts()[0]!.body).toMatchObject({ name_zh: "大發運輸", phonesText: "2345 6789", force: false });
    expect(d.querySelector("#dups")!.textContent).toContain("GC-00012 大發物流有限公司");
    click(d.querySelector("#force"));
    await tick(5);
    expect(posts()[1]!.body).toMatchObject({ force: true });
    expect(posts().length).toBe(2);
    expect(w.location.hash).toBe(`#/c/${CID}`);
  });
});

// ── 第二期：今日見客、續約、日曆、公司頁約見 ───────────────────────────────

const APPT_ID = "aaaa0000-0000-0000-0000-00000000000a";
const appt = (over: Record<string, unknown> = {}) => ({
  id: APPT_ID, company_id: CID, company_code: "GC-00012", company_name: "大發物流有限公司", company_name_en: null,
  company_phones: "23456789", contact_id: "k1", contact_name: "陳生", contact_title: "IT 經理", contact_phone: "9123 4567",
  starts_at: "2026-10-14T07:00:00.000Z", ends_at: "2026-10-14T08:00:00.000Z", address: "觀塘道 1 號 10 樓",
  purpose: "介紹 SME Bundle", meeting_notes: null, status: "已約", rescheduled: 0, source_call_id: null,
  created_at: "2026-10-10T02:00:00.000Z", ...over,
});
const RENEWAL = {
  source: "D", company_id: "cccccccc-0000-0000-0000-000000000002", company_code: "GC-00020", company_name: "續約物流公司",
  phones: "27771234", status: "不需要", contract_end: "2026-12-13", provider: "SmarTone", price: "$298 × 8",
  plan: null, stage: 1, days_left: 60, last_call_at: "2026-05-01T02:00:00.000Z",
};

describe("今日：見客同續約", () => {
  it("今日見客卡出時間、公司、聯絡人（撳得打）、地址（開地圖）；約／見兩個數", async () => {
    const { d } = await boot("#/", { "/meta": META, "/today": { ...TODAY, appointments: [appt()], renewals: [RENEWAL] } });
    expect(d.querySelector('[data-k="booked"]')!.textContent).toBe("3");
    expect(d.querySelector('[data-k="met"]')!.textContent).toBe("1");
    const card = d.querySelector("#todayAppts [data-appt]")!;
    expect(card.querySelector(".when")!.textContent).toBe("15:00–16:00");
    expect(card.textContent).toContain("大發物流有限公司");
    expect(card.querySelector(".who")!.textContent).toBe("陳生 IT 經理");
    expect(card.querySelector('a[href^="tel:"]')!.getAttribute("href")).toBe("tel:+85291234567");
    expect(card.querySelector(".addr a")!.getAttribute("href")).toBe(
      "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("觀塘道 1 號 10 樓"));
  });

  it("續約喺今日回撥卡入面：到期日連星期、對手台、之前話不需要；撳收埋送到期日同段數", async () => {
    const { d, posts } = await boot("#/", { "/meta": META, "/today": { ...TODAY, renewals: [RENEWAL] }, "/renewals/dismiss": { ok: true } });
    const row = d.querySelector("[data-renewal]")!;
    expect(row.textContent).toContain("續約物流公司");
    expect(row.textContent).toContain("約滿 12/13（日）");
    expect(row.textContent).toContain("60 日後到期");
    expect(row.textContent).toContain("SmarTone");
    expect(row.textContent).toContain("之前話不需要");
    expect(d.body.textContent).toContain("今日要回撥（2）");
    click(row.querySelector('[data-act="r-dismiss"]'));
    await tick();
    expect(posts()[0]).toMatchObject({ url: "/app/api/renewals/dismiss", body: { companyId: RENEWAL.company_id, contractEnd: "2026-12-13", stage: 1 } });
  });

  it("已見：填備註＋下一步 → 送 done；取消：送原因", async () => {
    const { d, posts } = await boot("#/", { "/meta": META, "/today": { ...TODAY, appointments: [appt()] }, "/appointments": { appointment: appt(), clashes: [] } });
    const card = d.querySelector("[data-appt]")!;
    expect((card.querySelector('[data-panel="done"]') as HTMLElement).hidden).toBe(true);
    click(card.querySelector('[data-act="a-done"]'));
    expect((card.querySelector('[data-panel="done"]') as HTMLElement).hidden).toBe(false);
    (card.querySelector('[data-v="notes"]') as HTMLTextAreaElement).value = "用緊 3HK 15 條線";
    (card.querySelector('[data-v="nextNote"]') as HTMLInputElement).value = "寄報價";
    (card.querySelector('[data-v="nextAt"]') as HTMLInputElement).value = "2026-10-16T11:00";
    click(card.querySelector('[data-act="a-done-save"]'));
    await tick();
    expect(posts()[0]).toMatchObject({
      url: `/app/api/appointments/${APPT_ID}/done`,
      body: { meetingNotes: "用緊 3HK 15 條線", nextStepNote: "寄報價", nextStepAt: "2026-10-16T11:00" },
    });
    const card2 = d.querySelector("[data-appt]")!;
    click(card2.querySelector('[data-act="a-cancel"]'));
    (card2.querySelector('[data-v="reason"]') as HTMLInputElement).value = "佢出咗差";
    click(card2.querySelector('[data-act="a-reason-save"]'));
    await tick();
    expect(posts().at(-1)).toMatchObject({ url: `/app/api/appointments/${APPT_ID}/cancel`, body: { reason: "佢出咗差" } });
  });

  it("已見咗嘅約冇「已見／取消」掣，淨係改備註", async () => {
    const { d } = await boot("#/", { "/meta": META, "/today": { ...TODAY, appointments: [appt({ status: "已見", meeting_notes: "傾得好" })] } });
    const card = d.querySelector("[data-appt]")!;
    expect(card.querySelector('[data-act="a-done"]')).toBeNull();
    expect(card.querySelector('[data-act="a-notes"]')!.textContent).toBe("改備註");
    expect(card.querySelector(".notes")!.textContent).toContain("傾得好");
  });
});

describe("日曆", () => {
  it("時間表：今日起 30 日、唔包取消，按香港日子分組，出公司／聯絡人／地址", async () => {
    const rows = [
      appt(),
      appt({ id: "aaaa0000-0000-0000-0000-00000000000b", starts_at: "2026-10-15T16:30:00.000Z", ends_at: null, company_name: "凌晨公司",
        contact_name: null, contact_title: null, contact_phone: null, address: null }),
    ];
    const { d, calls } = await boot("#/calendar", { "/meta": META, "/appointments": { rows } });
    const q = calls.find((c) => c.url.startsWith("/app/api/appointments?"))!.url;
    expect(decodeURIComponent(q)).toBe("/app/api/appointments?from=2026-10-14&to=2026-11-13&status=已約,已見,冇出現");
    const heads = [...d.querySelectorAll(".dayhead")].map((h) => h.textContent);
    expect(heads[0]).toContain("10/14（三）");
    expect(heads[0]).toContain("今日");
    expect(heads[1]).toContain("10/16（五）"); // UTC 10/15 16:30 ＝ 香港 10/16 00:30
    const second = d.querySelectorAll(".card")[1]!;
    expect(second.textContent).toContain("凌晨公司");
    expect(second.textContent).toContain("（冇指定聯絡人）");
    expect(second.textContent).toContain("23456789".slice(0, 4));
    expect(d.querySelector("#tabs .on")!.getAttribute("data-tab")).toBe("calendar");
  });

  it("月曆：個數落啱香港嗰日，星期一開頭；撳一日去嗰日時間表", async () => {
    const rows = [appt(), appt({ id: "x2", starts_at: "2026-10-14T09:00:00.000Z" }), appt({ id: "x3", starts_at: "2026-10-15T16:30:00.000Z" })];
    const { d, calls } = await boot("#/calendar?view=month", { "/meta": META, "/appointments": { rows } });
    expect(decodeURIComponent(calls.find((c) => c.url.startsWith("/app/api/appointments?"))!.url)).toContain("from=2026-10-01&to=2026-10-31");
    expect(d.querySelector('[data-day="2026-10-14"] .dcount')!.textContent).toBe("2 個約");
    expect(d.querySelector('[data-day="2026-10-16"] .dcount')!.textContent).toBe("1 個約");
    expect(d.querySelector('[data-day="2026-10-15"] .dcount')).toBeNull();
    // 2026-10-01 係星期四 → 前面三格空
    const cells = [...d.querySelectorAll(".month > .mday")];
    expect(cells.slice(0, 3).every((c) => c.classList.contains("empty"))).toBe(true);
    expect(cells[3]!.getAttribute("data-day")).toBe("2026-10-01");
    expect(d.querySelector('[data-day="2026-10-16"]')!.getAttribute("href")).toBe("#/calendar?day=2026-10-16");
  });
});

describe("公司頁：約見面", () => {
  it("冇揀時間唔送；揀「聽日 15:00」＋新聯絡人 → 送香港時間、地址預填公司地址", async () => {
    const { d, posts } = await boot(`#/c/${CID}`, {
      "/meta": META, [`/companies/${CID}`]: { ...companyFixture(), appointments: [] },
      "/appointments": { appointment: appt(), clashes: [appt({ company_name: "撞時段公司" })] },
    });
    const box = d.querySelector("#bookBox")!;
    click(box.querySelector("#bkSave"));
    await tick();
    expect(posts().length).toBe(0);
    expect(box.querySelector("#bkErr")!.textContent).toBe("揀幾時見");
    click(box.querySelector('[data-bktime="2026-10-15T15:00"]'));
    const sel = box.querySelector("#bkContact") as HTMLSelectElement;
    sel.value = "__new";
    sel.dispatchEvent(new d.defaultView!.Event("change"));
    expect((box.querySelector("#bkNew") as HTMLElement).hidden).toBe(false);
    (box.querySelector("#bkName") as HTMLInputElement).value = "李小姐";
    (box.querySelector("#bkPurpose") as HTMLInputElement).value = "傾 CloudPhone";
    click(box.querySelector("#bkSave"));
    await tick();
    expect(posts()[0]).toMatchObject({
      url: "/app/api/appointments",
      body: { companyId: CID, startsAt: "2026-10-15T15:00", minutes: 60, contactId: null,
        newContact: { name: "李小姐", title: null, phone: null }, address: "觀塘道 1 號", purpose: "傾 CloudPhone" },
    });
    expect(d.querySelector("#toast")!.textContent).toContain("撞時段公司");
  });

  it("公司頁出返呢間公司啲約（連日子）", async () => {
    const { d } = await boot(`#/c/${CID}`, {
      "/meta": META, [`/companies/${CID}`]: { ...companyFixture(), appointments: [appt({ status: "已見", meeting_notes: "OK" })] },
    });
    const card = d.querySelector("#apptCard [data-appt]")!;
    expect(card.querySelector(".when")!.textContent).toBe("10/14（三） 15:00–16:00");
    expect(d.querySelector("#apptCard h2")!.textContent).toBe("預約見面（1）");
  });
});

describe("數：本星期", () => {
  it("出本星期（星期一至今日）同約／見欄", async () => {
    const totals = { calls: 10, connected: 6, r: 2, d: 1, booked: 2, met: 1 };
    const { d } = await boot("#/stats", { "/meta": META, "/stats": {
      from: "2026-09-15", to: "2026-10-14", days: [{ day: "2026-10-14", ...totals }], totals,
      week: { from: "2026-10-12", to: "2026-10-14", ...totals, booked: 5 },
    } });
    expect(d.querySelector("#weekTitle")!.textContent).toBe("本星期（10/12（一） 至 10/14（三））");
    expect([...d.querySelectorAll("#week .stat b")].map((b) => b.textContent)).toEqual(["10", "6", "2", "1", "5", "1"]);
    expect(d.querySelector("thead")!.textContent).toContain("約");
  });
});
