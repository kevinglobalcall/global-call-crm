/* Global Call CRM —— 網頁（冇 framework，一個檔）。
 *
 * 規矩：
 *   · 所有由資料嚟嘅字一律 esc() 先入 HTML。
 *   · 日子時間一律香港時間，日期同星期一齊出（「10/20（二）15:00」）。
 *   · 寫入之後一律重新攞返 server 嘅資料再畫 —— 畫面見到嘅就係 DB 入面嘅。
 */
(function () {
  "use strict";

  // ── 小工具 ──────────────────────────────────────────────────────────────
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var view = function () { return $("#view"); };

  var toastTimer = null;
  function toast(msg, bad) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (bad ? " bad" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, bad ? 6000 : 3500);
  }

  function api(path, body) {
    var init = { credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      init.method = "POST";
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch("/app/api" + path, init).then(function (r) {
      if (r.status === 401) { location.href = "/app/login"; throw new Error("未登入"); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || "出錯（" + r.status + "）");
        return j;
      });
    });
  }

  function upload(path, file) {
    return fetch("/app/api" + path, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/octet-stream" }, body: file,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || "出錯（" + r.status + "）");
        return j;
      });
    });
  }

  // ── 香港時間 ────────────────────────────────────────────────────────────
  var WD = "日一二三四五六";
  var hkFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  function hkParts(d) {
    var o = {};
    hkFmt.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    if (o.hour === "24") o.hour = "00";
    var wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday);
    return { y: o.year, m: o.month, d: o.day, hh: o.hour, mm: o.minute, wd: wd };
  }
  /** 「10/20（二）15:00」 */
  function fmt(v, withTime) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d.getTime())) return "";
    var p = hkParts(d);
    var s = Number(p.m) + "/" + Number(p.d) + "（" + WD[p.wd] + "）";
    return withTime === false ? s : s + p.hh + ":" + p.mm;
  }
  /** "2026-10-14" → 「10/14（三）」（當香港日子，唔受部機時區影響） */
  function fmtDay(day) {
    if (!day) return "";
    return fmt(day + "T12:00:00+08:00", false);
  }
  /** 而家香港時間，datetime-local 格式 */
  function hkLocal(d) {
    var p = hkParts(d || new Date());
    return p.y + "-" + p.m + "-" + p.d + "T" + p.hh + ":" + p.mm;
  }
  function addDays(day, n) {
    var d = new Date(day + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function dayOfWeek(day) { return new Date(day + "T00:00:00Z").getUTCDay(); }

  function telLink(p) { return '<a href="tel:+852' + esc(p) + '">' + esc(p.slice(0, 4) + " " + p.slice(4)) + "</a>"; }
  var PHONE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.8 2z"/></svg>';
  /** 公司頁：大粒「一撳就打」掣（同 telLink 同一條 tel: 網址） */
  function dialLink(p, label) {
    return '<a class="dial" href="tel:+852' + esc(p) + '">' + PHONE_SVG + esc(p.slice(0, 4) + " " + p.slice(4)) +
      (label ? ' <span class="lbl">' + esc(label) + "</span>" : "") + "</a>";
  }
  /** company_overview.phones 係「23456789 / 23456790（傳真）」 */
  function phonesHtml(s) {
    if (!s) return '<span class="muted">冇電話</span>';
    return s.split(" / ").map(function (x) {
      var fax = /（傳真）$/.test(x);
      var n = x.replace(/（傳真）$/, "");
      return fax ? '<span class="muted">傳真 ' + esc(n.slice(0, 4) + " " + n.slice(4)) + "</span>" : telLink(n);
    }).join(" ");
  }
  function nameOf(c) { return c.name_zh || c.name_en || ""; }
  /** 第二行英文名：同中文名一樣（空格大細楷唔理）就唔再出 */
  function altName(c) {
    if (!c.name_zh || !c.name_en) return "";
    var k = function (s) { return String(s).toLowerCase().replace(/\s+/g, ""); };
    return k(c.name_zh) === k(c.name_en) ? "" : c.name_en;
  }
  function statusPill(s) {
    var cls = { "未打": "", "跟進中": "acc", "不需要": "bad", "其他人跟進": "warn", "已成交": "ok", "已結業": "bad" }[s] || "";
    return '<span class="pill ' + cls + '">' + esc(s) + "</span>";
  }
  function rd(r, d) {
    return (r ? '<span class="pill r">R</span> ' : "") + (d ? '<span class="pill d">D</span>' : "");
  }

  // ── 開機資料 ────────────────────────────────────────────────────────────
  var META = null;
  function meta(force) {
    if (META && !force) return Promise.resolve(META);
    return api("/meta").then(function (m) { META = m; return m; });
  }
  function rule(outcome) {
    var r = META.outcomes.filter(function (o) { return o.outcome === outcome; })[0];
    return r || { time: "optional", hint: "" };
  }

  // ── 預約卡（今日、日曆、公司頁共用）──────────────────────────────────────
  function hkDayOf(v) { var p = hkParts(new Date(v)); return p.y + "-" + p.m + "-" + p.d; }
  function hhmm(v) { var p = hkParts(new Date(v)); return p.hh + ":" + p.mm; }
  function mapsLink(addr) {
    return '<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr) + '" target="_blank" rel="noopener">' + esc(addr) + "</a>";
  }
  var APPT_PILL = { "已約": "acc", "已見": "ok", "取消": "bad", "冇出現": "warn" };

  /** opts.withDate：出埋日子（公司頁）；opts.noCompany：唔出公司名（公司頁） */
  function apptCard(a, opts) {
    opts = opts || {};
    var when = (opts.withDate ? fmt(a.starts_at, false) + " " : "") + hhmm(a.starts_at) + (a.ends_at ? "–" + hhmm(a.ends_at) : "");
    var contact = [a.contact_name, a.contact_title].filter(Boolean).join(" ");
    var phone = a.contact_phone ? a.contact_phone.replace(/[^0-9]/g, "") : "";
    var phoneHtml = /^[2-9][0-9]{7}$/.test(phone) ? telLink(phone)
      : a.contact_phone ? esc(a.contact_phone)
      : a.company_phones ? a.company_phones.split(" / ").map(telLink).join(" ") : "";
    var open = a.status === "已約";
    return '<div class="item appt" data-appt="' + esc(a.id) + '">' +
      '<div class="spread"><span><b class="when">' + esc(when) + "</b> " +
      '<span class="pill ' + (APPT_PILL[a.status] || "") + '">' + esc(a.status) + "</span>" +
      (a.rescheduled ? ' <span class="small muted">改過 ' + a.rescheduled + " 次</span>" : "") + "</span>" +
      (opts.noCompany ? "" : '<a class="name" href="#/c/' + esc(a.company_id) + '">' + esc(a.company_name) + "</a>") + "</div>" +
      '<div class="small">' + (contact ? '<span class="who">' + esc(contact) + "</span> " : '<span class="muted">（冇指定聯絡人）</span> ') +
      '<span class="phones">' + phoneHtml + "</span></div>" +
      (a.address ? '<div class="small addr">📍 ' + mapsLink(a.address) + "</div>" : '<div class="small muted">（冇地址）</div>') +
      (a.purpose ? '<div class="small muted pre">' + esc(a.purpose) + "</div>" : "") +
      (a.meeting_notes ? '<div class="small pre notes">📝 ' + esc(a.meeting_notes) + "</div>" : "") +
      '<div class="row" style="margin-top:6px">' +
      (open ? '<button class="btn sm primary" data-act="a-done">已見</button><button class="btn sm" data-act="a-move">改期</button>' +
        '<button class="btn sm" data-act="a-noshow">冇出現</button><button class="btn sm danger" data-act="a-cancel">取消</button>'
        : '<button class="btn sm" data-act="a-notes">' + (a.meeting_notes ? "改備註" : "寫備註") + "</button>" +
          (a.status === "冇出現" ? '<button class="btn sm" data-act="a-move">再約過</button>' : "")) + "</div>" +
      '<div class="panel" data-panel="done" hidden><label class="f"><span>見面備註</span><textarea data-v="notes">' + esc(a.meeting_notes || "") + "</textarea></label>" +
      '<div class="grid2"><label class="f"><span>下一步（會開跟進提醒）</span><input type="text" data-v="nextNote" placeholder="例：寄報價"></label>' +
      '<label class="f"><span>下一步幾時</span><input type="datetime-local" data-v="nextAt"></label></div>' +
      '<button class="btn sm primary" data-act="a-done-save">存：已見</button></div>' +
      '<div class="panel" data-panel="notes" hidden><textarea data-v="notes2">' + esc(a.meeting_notes || "") + '</textarea><button class="btn sm primary" data-act="a-notes-save">存備註</button></div>' +
      '<div class="panel row" data-panel="move" hidden><input type="datetime-local" class="grow" data-v="moveAt"><button class="btn sm primary" data-act="a-move-save">改</button></div>' +
      '<div class="panel row" data-panel="reason" hidden><input type="text" class="grow" data-v="reason" placeholder="原因（可以唔填）"><button class="btn sm primary" data-act="a-reason-save">確定</button></div>' +
      "</div>";
  }

  function wireAppts(root, after) {
    $$("[data-appt]", root).forEach(function (card) {
      var id = card.getAttribute("data-appt");
      var pending = null;
      var show = function (name) { $$("[data-panel]", card).forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== name; }); };
      card.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (!b || !b.getAttribute("data-act").startsWith("a-")) return;
        var act = b.getAttribute("data-act");
        var v = function (k) { return $('[data-v="' + k + '"]', card).value.trim(); };
        var p = null, msg = "";
        if (act === "a-done") return show("done");
        if (act === "a-notes") return show("notes");
        if (act === "a-move") { show("move"); $('[data-v="moveAt"]', card).value = hkLocal(new Date(Date.now() + 86400e3)).slice(0, 11) + "10:00"; return; }
        if (act === "a-cancel" || act === "a-noshow") { pending = act === "a-cancel" ? "cancel" : "noshow"; return show("reason"); }
        if (act === "a-done-save") {
          p = api("/appointments/" + id + "/done", { meetingNotes: v("notes") || null, nextStepNote: v("nextNote") || null, nextStepAt: v("nextAt") || null });
          msg = "記低咗：已見";
        } else if (act === "a-notes-save") {
          p = api("/appointments/" + id, { meetingNotes: v("notes2") || null });
          msg = "備註存咗";
        } else if (act === "a-move-save") {
          if (!v("moveAt")) return toast("揀個新時間", true);
          p = api("/appointments/" + id, { startsAt: v("moveAt") });
          msg = "改咗期";
        } else if (act === "a-reason-save") {
          p = api("/appointments/" + id + "/" + pending, { reason: v("reason") || null });
          msg = pending === "cancel" ? "取消咗" : "記低咗：冇出現";
        }
        if (!p) return;
        b.disabled = true;
        p.then(function (r) {
          var clash = r && r.clashes && r.clashes.length ? "（⚠️ 同 " + r.clashes.map(function (c) { return hhmm(c.starts_at) + " " + c.company_name; }).join("、") + " 好近）" : "";
          toast(msg + clash);
          after();
        }).catch(function (err) { b.disabled = false; toast(err.message, true); });
      });
    });
  }

  function renewalRow(x) {
    var when = x.days_left < 0 ? "過咗期 " + (-x.days_left) + " 日" : x.days_left + " 日後到期";
    return '<div class="item" data-renewal="' + esc(x.company_id) + '" data-end="' + esc(x.contract_end) + '" data-stage="' + x.stage + '">' +
      '<div class="spread"><a class="name" href="#/c/' + esc(x.company_id) + '">' + esc(x.company_name) + "</a>" +
      '<span class="' + (x.days_left < 0 ? "overdue" : "") + '">' + esc(when) + "</span></div>" +
      '<div class="row small"><span class="pill d">續約 ' + (x.stage === 2 ? "30" : "90") + " 日內</span>" +
      '<span>約滿 ' + esc(fmtDay(x.contract_end)) + "</span>" +
      (x.provider ? '<span class="muted">' + esc(x.provider) + "</span>" : "") +
      (x.price ? '<span class="muted">' + esc(x.price) + "</span>" : "") +
      (x.status === "不需要" ? '<span class="pill bad">之前話不需要</span>' : "") + "</div>" +
      '<div class="row small"><span class="phones">' + (x.phones ? x.phones.split(" / ").map(telLink).join(" ") : '<span class="muted">冇電話</span>') + "</span></div>" +
      '<div class="row" style="margin-top:6px"><a class="btn sm" href="#/c/' + esc(x.company_id) + '">去記電話</a>' +
      '<button class="btn sm" data-act="r-dismiss">收埋</button></div></div>';
  }

  function wireRenewals(root, after) {
    $$("[data-renewal]", root).forEach(function (row) {
      $('[data-act="r-dismiss"]', row).addEventListener("click", function (e) {
        e.target.disabled = true;
        api("/renewals/dismiss", {
          companyId: row.getAttribute("data-renewal"), contractEnd: row.getAttribute("data-end"), stage: Number(row.getAttribute("data-stage")),
        }).then(function () { toast("收埋咗（佢之後報新到期日會再出）"); after(); })
          .catch(function (err) { e.target.disabled = false; toast(err.message, true); });
      });
    });
  }

  // ── 今日 ────────────────────────────────────────────────────────────────
  /** compact：公司頁入面用，唔使再出公司名同電話 */
  function taskRow(t, compact) {
    var due = t.due_at ? fmt(t.due_at) : "冇指定時間";
    var when = '<span class="' + (t.overdue ? "overdue" : "") + '">' + (t.overdue ? "過咗期 " : "") + esc(due) + "</span>";
    return '<div class="item" data-task="' + esc(t.id) + '">' +
      (compact
        ? '<div class="row"><span class="pill acc">' + esc(t.kind) + "</span>" + when + "</div>"
        : '<div class="spread"><a class="name" href="#/c/' + esc(t.company_id) + '">' + esc(t.company_name) + "</a>" + when + "</div>" +
          '<div class="row small"><span class="pill acc">' + esc(t.kind) + "</span>" +
          '<span class="phones">' + (t.phones ? t.phones.split(" / ").map(telLink).join(" ") : '<span class="muted">冇電話</span>') + "</span></div>") +
      (t.note ? '<div class="small muted pre">' + esc(t.note) + "</div>" : "") +
      '<div class="row" style="margin-top:6px">' +
      '<button class="btn sm" data-act="done">完成</button>' +
      '<button class="btn sm" data-act="move">改時間</button>' +
      '<button class="btn sm danger" data-act="cancel">取消</button></div>' +
      '<div class="row move" hidden style="margin-top:6px"><input type="datetime-local" class="grow">' +
      '<button class="btn sm primary" data-act="move-save">存</button></div>' +
      "</div>";
  }

  function wireTasks(root, after) {
    $$("[data-task]", root).forEach(function (row) {
      var id = row.getAttribute("data-task");
      row.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (!b) return;
        var act = b.getAttribute("data-act");
        if (act === "move") { $(".move", row).hidden = false; $(".move input", row).value = hkLocal(new Date(Date.now() + 3600e3)); return; }
        var p;
        if (act === "done") p = api("/tasks/" + id + "/done", {});
        else if (act === "cancel") p = api("/tasks/" + id + "/cancel", {});
        else if (act === "move-save") p = api("/tasks/" + id + "/reschedule", { dueAt: $(".move input", row).value || null });
        else return;
        b.disabled = true;
        p.then(function () { toast(act === "done" ? "收咗" : act === "cancel" ? "取消咗" : "改咗時間"); after(); })
          .catch(function (err) { b.disabled = false; toast(err.message, true); });
      });
    });
  }

  function viewToday() {
    return api("/today").then(function (d) {
      var s = d.stats;
      var rate = s.calls ? Math.round((s.connected / s.calls) * 100) + "%" : "—";
      var html = '<div class="spread"><h1>今日 ' + esc(fmtDay(d.today)) + "</h1>" +
        '<a class="btn sm" href="#/companies?cold=1">打冷電名單 →</a></div>' +
        statTiles(s, d.today, d.today, { connected: "接通（" + rate + "）", r: "R 負責人", d: "D 詳盡資料" }, true);

      if (d.appointments.length) {
        html += '<div class="card" id="todayAppts"><div class="spread"><h2 style="margin-top:0">今日見客（' + d.appointments.length + "）</h2>" +
          '<a class="small" href="#/calendar">日曆 →</a></div>' + d.appointments.map(function (a) { return apptCard(a); }).join("") + "</div>";
      }

      var n = d.due.length + d.renewals.length;
      html += '<div class="card"><h2 style="margin-top:0">今日要回撥（' + n + "）</h2>" +
        (n ? d.due.map(function (t) { return taskRow(t); }).join("") +
          (d.renewals.length ? '<h2 class="small muted" style="margin:14px 0 0">續約提醒（' + d.renewals.length + "）—— 對手台合約快到期，打一次電話就會自己收</h2>" +
            d.renewals.map(renewalRow).join("") : "")
          : '<p class="muted">冇 —— 去打冷電名單啦</p>') + "</div>";
      if (d.upcoming.length) {
        html += '<div class="card"><details><summary>之後 7 日（' + d.upcoming.length + "）</summary>" +
          d.upcoming.map(function (t) { return taskRow(t); }).join("") + "</details></div>";
      }
      html += '<div class="card"><h2 style="margin-top:0">近 14 日</h2><div class="scroll"><table><thead><tr>' +
        '<th>日子</th><th class="num">通數</th><th class="num">接通</th><th class="num">R</th><th class="num">D</th><th class="num">約</th><th class="num">見</th></tr></thead><tbody>' +
        d.history.map(function (h) {
          var n = function (k) { return '<td class="num">' + detailLink(k, h.day, h.day, h[k]) + "</td>"; };
          return "<tr><td>" + esc(fmtDay(h.day)) + "</td>" + n("calls") + n("connected") + n("r") + n("d") + n("booked") + n("met") + "</tr>";
        }).join("") + "</tbody></table></div></div>";
      view().innerHTML = html;
      wireTasks(view(), render);
      wireAppts(view(), render);
      wireRenewals(view(), render);
    });
  }

  // ── 公司清單 ────────────────────────────────────────────────────────────
  var FILTER_KEYS = ["q", "cold", "status", "industry", "r", "d", "lastOutcome", "productId", "mis", "called", "contractEndBy", "sort"];
  function readFilters() {
    var q = (location.hash.split("?")[1] || "");
    var p = new URLSearchParams(q);
    var f = {};
    FILTER_KEYS.forEach(function (k) { var v = p.get(k); if (v) f[k] = v; });
    return f;
  }
  function filterQuery(f) {
    var p = new URLSearchParams();
    FILTER_KEYS.forEach(function (k) { if (f[k]) p.set(k, f[k]); });
    return p.toString();
  }
  function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (cur === v ? " selected" : "") + ">" + esc(label) + "</option>"; }

  function viewCompanies() {
    return meta().then(function (m) {
      var f = readFilters();
      var sel = function (k, label, opts) {
        return '<label class="f"><span>' + label + '</span><select data-f="' + k + '">' + opt("", k === "sort" ? "預設（冷電名單：未打行先）" : "全部", f[k] || "") +
          opts.map(function (o) { return opt(o[0], o[1], f[k] || ""); }).join("") + "</select></label>";
      };
      var html = '<div class="spread"><h1>公司</h1><a class="btn sm" href="#/new">＋新增公司</a></div>' +
        '<div class="row"><input type="search" class="grow" data-f="q" placeholder="搵名／電話／電郵／編號" value="' + esc(f.q || "") + '">' +
        '<label class="check"><input type="checkbox" data-f="cold"' + (f.cold ? " checked" : "") + "> 冷電名單</label></div>" +
        "<details" + (Object.keys(f).filter(function (k) { return k !== "q" && k !== "cold"; }).length ? " open" : "") + "><summary>篩選</summary>" +
        '<div class="filters">' +
        sel("status", "狀態", m.statuses.map(function (s) { return [s, s]; })) +
        sel("industry", "行業", m.industries.map(function (i) { return [i.industry, i.industry + "（" + i.n + "）"]; })) +
        sel("r", "R", [["yes", "有 R"], ["no", "未有 R"]]) +
        sel("d", "D", [["yes", "有 D"], ["no", "未有 D"]]) +
        sel("lastOutcome", "最後結果", m.outcomes.map(function (o) { return [o.outcome, o.outcome]; })) +
        sel("productId", "有興趣", m.products.map(function (p) { return [p.id, p.name]; })) +
        sel("mis", "MIS", [["yes", "查過"], ["no", "未查"]]) +
        sel("called", "打過未", [["yes", "打過"], ["no", "未打過"]]) +
        '<label class="f"><span>合約喺呢日或之前到期</span><input type="date" data-f="contractEndBy" value="' + esc(f.contractEndBy || "") + '"></label>' +
        sel("sort", "排序", [["recent", "最近打行先"], ["never_called", "未打行先"], ["contract_end", "合約到期"], ["name", "名"], ["code", "編號"], ["created", "最新入"]]) +
        '</div><button class="btn sm" data-act="clear">清晒篩選</button></details>' +
        '<div class="card"><div class="spread"><div id="summary" class="muted">搵緊…</div>' +
        '<a class="btn sm" id="export" href="#">導出 Excel</a></div><div id="list"></div>' +
        '<button class="btn block" id="more" hidden>載多啲</button></div>';
      view().innerHTML = html;

      var offset = 0;
      var seq = 0;
      var ROWS = {};
      wireRows($("#list"), m, ROWS, function () { return f; });
      function load(reset) {
        var my = ++seq;
        if (reset) offset = 0;
        var q = filterQuery(f);
        $("#export").href = "/app/api/companies.xlsx" + (q ? "?" + q : "");
        return api("/companies?" + q + (q ? "&" : "") + "limit=50&offset=" + offset).then(function (r) {
          if (my !== seq) return; // 打字快過 server：舊結果唔好蓋新結果
          $("#summary").innerHTML = "共 <b>" + r.total + "</b> 間 · R <b>" + r.totalR + "</b> 間 · D <b>" + r.totalD + "</b> 間";
          r.rows.forEach(function (c) { ROWS[c.id] = c; });
          var rows = r.rows.map(function (c) { return '<div class="crow" data-row="' + esc(c.id) + '">' + crowInner(c, m) + "</div>"; }).join("");
          if (reset) $("#list").innerHTML = rows || '<p class="muted">冇公司夾到</p>';
          else $("#list").insertAdjacentHTML("beforeend", rows);
          offset += r.rows.length;
          $("#more").hidden = offset >= r.total;
        }).catch(function (e) { toast(e.message, true); });
      }

      function sync() {
        var q = filterQuery(f);
        history.replaceState(null, "", "#/companies" + (q ? "?" + q : ""));
        load(true);
      }
      var timer = null;
      $$("[data-f]").forEach(function (el) {
        var k = el.getAttribute("data-f");
        var on = el.type === "search" ? "input" : "change";
        el.addEventListener(on, function () {
          var v = el.type === "checkbox" ? (el.checked ? "1" : "") : el.value.trim();
          if (v) f[k] = v; else delete f[k];
          clearTimeout(timer);
          timer = setTimeout(sync, el.type === "search" ? 300 : 0);
        });
      });
      $('[data-act="clear"]').addEventListener("click", function () {
        f = {};
        location.hash = "#/companies";
      });
      $("#more").addEventListener("click", function () { load(false); });
      return load(true);
    });
  }

  // ── 公司清單每行：直接打、記結果、改狀態、寫備註（Kevin 2026-10-16「直接顯示電話 email及tick狀態 備註欄」）──

  /** overview 個 phones「23456789 / 23456790（傳真）」→ 撥號掣＋傳真字 */
  function rowPhones(c) {
    var parts = (c.phones || "").split(" / ").filter(Boolean);
    if (!parts.length) return '<span class="muted small">冇電話</span>';
    return parts.map(function (x) {
      var fax = /（傳真）$/.test(x), n = x.replace(/（傳真）$/, "");
      return fax ? '<span class="muted small">傳真 ' + esc(n.slice(0, 4) + " " + n.slice(4)) + "</span>" : dialLink(n);
    }).join(" ");
  }

  function lastNoteHtml(n) {
    if (!n) return '<span class="muted">未有備註</span>';
    var head = n.kind === "import" ? "名單匯入" :
      fmt(n.at) + (n.kind === "call" ? " · " + (n.outcome || "") : n.author ? " · " + n.author : "");
    return '<b class="small">' + esc(head) + "</b> " + esc(n.text);
  }

  function crowInner(c, m) {
    var emails = (c.emails || "").split(" / ").filter(Boolean);
    return '<div class="cmain">' +
      '<div class="spread"><a class="name" href="#/c/' + esc(c.id) + '">' + esc(nameOf(c)) +
      (altName(c) ? ' <span class="muted small">' + esc(altName(c)) + "</span>" : "") + "</a>" +
      '<span class="row small"><span class="muted">' + esc(c.code) + "</span>" +
      '<button type="button" class="btn sm danger" data-act="del-co">刪除</button></span></div>' +
      '<div class="dials">' + rowPhones(c) + "</div>" +
      (emails.length ? '<div class="small">' + emails.map(function (e) { return '<a href="mailto:' + esc(e) + '">' + esc(e) + "</a>"; }).join(" · ") + "</div>" : "") +
      '<div class="row small"><select class="stsel" data-act="status" aria-label="狀態">' +
      m.statuses.map(function (st) { return opt(st, st, c.status); }).join("") + "</select> " + rd(c.ever_r, c.ever_d) +
      (c.industry ? ' <span class="muted">' + esc(c.industry) + "</span>" : "") +
      (c.call_count ? ' <span class="muted">打過 ' + c.call_count + " 次 · " + esc(c.last_outcome || "") + " " + esc(fmt(c.last_call_at, false)) + "</span>" : "") +
      (c.d_contract_end ? ' <span class="pill d">' + esc(c.d_provider || "") + " 約滿 " + esc(c.d_contract_end) + "</span>" : "") +
      (c.followed_by ? ' <span class="pill warn">' + esc(c.followed_by) + " 跟</span>" : "") +
      (c.mis_checked ? "" : ' <span class="pill">MIS 未查</span>') + "</div>" +
      '<div class="followbox" hidden><input type="text" data-v="follower" placeholder="邊個同事跟緊（可以留空）">' +
      '<button class="btn sm primary" data-act="follow-save">存</button></div></div>' +
      '<div class="cact"><div class="lastnote small">' + lastNoteHtml(c.last_note) + "</div>" +
      '<textarea data-v="note" rows="1" placeholder="備註／今次電話講咗乜"></textarea>' +
      '<div class="qouts">' + m.outcomes.map(function (o) {
        return '<button type="button" data-act="out" data-o="' + esc(o.outcome) + '">' + esc(o.outcome) + "</button>";
      }).join("") + '<button type="button" class="addnote" data-act="note">加備註</button></div>' +
      '<div class="qextra" hidden></div><div class="qdone small" hidden></div></div>';
  }

  /** 清單成個用一個 listener（行會重畫，唔使逐行再 wire） */
  function wireRows(list, m, ROWS, filters) {
    function rowOf(el) { return el.closest("[data-row]"); }
    function ruleOf(o) { return m.outcomes.filter(function (x) { return x.outcome === o; })[0]; }
    function refresh(row, done) {
      var id = row.getAttribute("data-row");
      var fq = filterQuery(filters());
      return Promise.all([
        api("/companies?id=" + encodeURIComponent(id) + "&limit=1"),
        api("/companies?" + fq + (fq ? "&" : "") + "id=" + encodeURIComponent(id) + "&limit=1"),
      ]).then(function (x) {
        var c = x[0].rows[0];
        if (!c) return;
        ROWS[id] = c;
        row.innerHTML = crowInner(c, m);
        var gone = x[1].total === 0;
        row.classList.toggle("gone", gone);
        var msg = (done || "") + (gone ? (done ? " · " : "") + "已經唔喺呢個清單（而家：" + c.status + "）" : "");
        if (msg) { var q = $(".qdone", row); q.innerHTML = msg; q.hidden = false; }
      });
    }
    /**
     * 記完結果／改完狀態自動跳去下一間（Kevin 2026-10-16「按完狀態後自動跳下一個」）。
     * 呢間仲喺度（有「撤回」），淨係捲落去；冇下一間而「載多啲」仲有，就先載埋。
     */
    function jumpNext(row) {
      var next = row.nextElementSibling;
      while (next && !next.hasAttribute("data-row")) next = next.nextElementSibling;
      var more = $("#more");
      if (!next && more && !more.hidden) {
        more.click();
        var tries = 0;
        var wait = setInterval(function () {
          tries++;
          var n = row.nextElementSibling;
          if (n || tries > 40) { clearInterval(wait); if (n) go(n); }
        }, 100);
        return;
      }
      if (next) go(next);
      function go(el) {
        if (el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("nextup");
        setTimeout(function () { el.classList.remove("nextup"); }, 1600);
      }
    }

    function logCall(row, outcome, extra) {
      var id = row.getAttribute("data-row"), c = ROWS[id];
      var note = $('[data-v="note"]', row).value.trim();
      var body = { companyId: id, outcome: outcome, attemptNo: (c.call_count || 0) + 1, content: note || null,
        callbackAt: (extra && extra.callbackAt) || null, otherFollower: (extra && extra.otherFollower) || null,
        phoneDialed: ((c.phones || "").split(" / ").filter(function (p) { return !/傳真/.test(p); })[0] || null) };
      $$("button", row).forEach(function (b) { b.disabled = true; });
      return api("/calls", body).then(function (res) {
        toast("記低咗：" + nameOf(c) + " 第 " + res.call.attempt_no + " 次 · " + res.call.outcome);
        // 等嗰行重畫完先跳：佢多咗「記低咗…撤回」會變高，早跳會停喺下一間中間
        return refresh(row, "記低咗：第 " + res.call.attempt_no + " 次 · " + esc(res.call.outcome) +
          ' <button class="btn sm" data-act="undo" data-call="' + esc(res.call.id) + '">撤回</button>').then(function () { jumpNext(row); });
      }).catch(function (e) { $$("button", row).forEach(function (b) { b.disabled = false; }); toast(e.message, true); });
    }
    list.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (!b || b.tagName === "SELECT") return;
      var row = rowOf(b);
      if (!row) return;
      var id = row.getAttribute("data-row");
      var act = b.getAttribute("data-act");
      var extraBox = $(".qextra", row);
      if (act === "out") {
        var o = b.getAttribute("data-o"), r = ruleOf(o);
        if (r && r.time === "required") {
          extraBox.innerHTML = '<div class="small muted">' + esc(o) + "：幾點再打？</div>" + '<div class="quick">' +
            quickTimes(m.today).map(function (t) { return '<button type="button" class="btn sm" data-act="qtime" data-time="' + esc(t[1]) + '">' + esc(t[0]) + "</button>"; }).join("") +
            '</div><div class="row"><input type="datetime-local" data-v="cb"><button class="btn sm primary" data-act="out-time" data-o="' + esc(o) + '">記低</button></div>';
          extraBox.hidden = false;
          return;
        }
        if (o === "其他人跟進") {
          extraBox.innerHTML = '<div class="row"><input type="text" data-v="other" placeholder="邊個同事跟緊（一定要填）">' +
            '<button class="btn sm primary" data-act="out-other">記低</button></div>';
          extraBox.hidden = false;
          return;
        }
        logCall(row, o);
        return;
      }
      if (act === "qtime") { $('[data-v="cb"]', row).value = b.getAttribute("data-time"); return; }
      if (act === "out-time") {
        var cb = $('[data-v="cb"]', row).value;
        if (!cb) { toast("「幾點鐘再打」一定要揀時間", true); return; }
        logCall(row, b.getAttribute("data-o"), { callbackAt: cb });
        return;
      }
      if (act === "out-other") {
        var who = $('[data-v="other"]', row).value.trim();
        if (!who) { toast("填埋邊個同事跟緊", true); return; }
        logCall(row, "其他人跟進", { otherFollower: who });
        return;
      }
      if (act === "note") {
        var text = $('[data-v="note"]', row).value.trim();
        if (!text) { toast("寫咗備註先撳", true); return; }
        b.disabled = true;
        api("/companies/" + id + "/remarks", { body: text }).then(function () {
          toast("加咗備註");
          return refresh(row, "加咗備註");
        }).catch(function (er) { b.disabled = false; toast(er.message, true); });
        return;
      }
      if (act === "undo") {
        if (!confirm("撤回呢次電話記錄？")) return;
        api("/calls/" + b.getAttribute("data-call") + "/delete", {}).then(function () {
          toast("撤回咗");
          return refresh(row, "撤回咗");
        }).catch(function (er) { toast(er.message, true); });
        return;
      }
      if (act === "del-co") {
        var co = ROWS[id];
        if (!confirm("刪除「" + nameOf(co) + "」（" + co.code + "）？\n佢嘅電話、電郵、備註會一齊刪，冇得返轉頭。\n（有電話記錄嘅唔刪得，改狀態就得）")) return;
        api("/companies/" + id + "/delete", {}).then(function (r) {
          toast("刪咗 " + r.deleted.code + " " + r.deleted.name);
          row.classList.add("gone");
          row.innerHTML = '<div class="small muted">已刪除 ' + esc(r.deleted.code + " " + r.deleted.name) + "</div>";
          var tot = $("#summary b");
          if (tot && Number(tot.textContent) > 0) tot.textContent = String(Number(tot.textContent) - 1);
        }).catch(function (er) { toast(er.message, true); });
        return;
      }
      if (act === "follow-save") {
        var name = $('[data-v="follower"]', row).value.trim();
        api("/companies/" + id, { status: "其他人跟進", followed_by: name || null }).then(function () {
          toast("改咗做其他人跟進");
          // 等嗰行重畫完先跳：佢多咗「記低咗…撤回」會變高，早跳會停喺下一間中間
          return refresh(row, "狀態改咗做其他人跟進").then(function () { jumpNext(row); });
        }).catch(function (er) { toast(er.message, true); });
      }
    });
    list.addEventListener("change", function (e) {
      var sel = e.target.closest('[data-act="status"]');
      if (!sel) return;
      var row = rowOf(sel), id = row.getAttribute("data-row"), before = ROWS[id].status;
      if (sel.value === "其他人跟進") { $(".followbox", row).hidden = false; return; }
      $(".followbox", row).hidden = true;
      // 由「其他人跟進」改走 → 同事名一齊清，唔係佢會照樣唔出冷電名單
      var patch = { status: sel.value };
      if (ROWS[id].followed_by) patch.followed_by = null;
      api("/companies/" + id, patch).then(function () {
        toast("狀態：" + before + " → " + sel.value);
        // 等嗰行重畫完先跳：佢多咗「記低咗…撤回」會變高，早跳會停喺下一間中間
        return refresh(row, "狀態：" + esc(before) + " → " + esc(sel.value)).then(function () { jumpNext(row); });
      }).catch(function (er) { sel.value = before; toast(er.message, true); });
    });
  }

  // ── 公司頁（記電話喺度）──────────────────────────────────────────────────
  var PROVIDERS = ["CSL", "1O1O", "CMHK 中國移動", "3HK", "SmarTone", "HKBN", "HGC", "中國聯通", "Club SIM", "其他"];

  function phonesToText(phones) {
    return phones.map(function (p) {
      var n = p.phone.slice(0, 4) + " " + p.phone.slice(4);
      return (p.label === "總機" || p.label === "其他" ? "" : p.label + " ") + n;
    }).join(" / ");
  }

  function quickTimes(today) {
    var now = new Date();
    var inHour = hkLocal(new Date(now.getTime() + 3600e3));
    var tomorrow = addDays(today, 1);
    var wd = dayOfWeek(today);
    var nextMon = addDays(today, ((8 - wd) % 7) || 7);
    return [
      ["1 個鐘後", inHour],
      ["今日 17:00", today + "T17:00"],
      ["聽日 10:00", tomorrow + "T10:00"],
      ["聽日 15:00", tomorrow + "T15:00"],
      ["下星期一 10:00", nextMon + "T10:00"],
    ];
  }

  function callForm(d) {
    var phones = d.phones.filter(function (p) { return p.label !== "傳真"; });
    return '<div class="card" id="callform"><div class="spread"><h2 style="margin-top:0">記低今次電話</h2>' +
      '<label class="small">第 <input type="number" min="1" id="attempt" value="' + d.nextAttempt + '" style="width:64px;min-height:32px;padding:4px 6px"> 次致電</label></div>' +
      '<div class="outcomes">' + META.outcomes.map(function (o) {
        return '<button type="button" data-outcome="' + esc(o.outcome) + '">' + esc(o.outcome) + "</button>";
      }).join("") + "</div>" +
      '<div id="hint" class="small muted"></div>' +
      '<div id="timebox" hidden><label class="f"><span id="timelabel">回撥時間</span><input type="datetime-local" id="callback"></label>' +
      '<div class="quick">' + quickTimes(META.today).map(function (q) {
        return '<button type="button" class="btn sm" data-time="' + esc(q[1]) + '">' + esc(q[0]) + "</button>";
      }).join("") + '<button type="button" class="btn sm" data-time="">唔揀</button></div></div>' +
      '<div id="otherbox" hidden><label class="f"><span>邊個同事跟緊</span><input type="text" id="other" placeholder="同事名"></label></div>' +
      '<div class="row"><label class="check"><input type="checkbox" id="isR"> R 搵到負責人</label>' +
      '<label class="check"><input type="checkbox" id="isD"> D 攞到詳盡資料</label></div>' +
      '<div class="dbox" id="dbox" hidden><div class="grid2">' +
      '<label class="f"><span>合約到期日</span><input type="date" id="dEnd"></label>' +
      '<label class="f"><span>用緊邊個台</span><input type="text" id="dProvider" list="providers"></label>' +
      '<label class="f"><span>而家價錢</span><input type="text" id="dPrice" placeholder="例：$198/月 × 12 條"></label>' +
      '<label class="f"><span>套餐內容</span><input type="text" id="dPlan" placeholder="例：本地無限 + 20GB"></label>' +
      '</div><datalist id="providers">' + PROVIDERS.map(function (p) { return '<option value="' + esc(p) + '">'; }).join("") + "</datalist></div>" +
      (phones.length > 1 ? '<label class="f" style="margin-top:8px"><span>撥咗邊個號</span><select id="dialed">' +
        phones.map(function (p) { return opt(p.phone, p.phone.slice(0, 4) + " " + p.phone.slice(4) + "（" + p.label + "）", ""); }).join("") +
        "</select></label>" : "") +
      '<label class="f" style="margin-top:8px"><span>內容</span><textarea id="content" placeholder="講咗乜、搵邊個、佢用緊乜…"></textarea></label>' +
      '<div id="callerr" class="err" hidden></div>' +
      '<button class="btn primary block" id="save" disabled>揀咗結果先記低</button></div>';
  }

  function wireCallForm(d) {
    var form = $("#callform");
    var chosen = null;
    var save = $("#save", form);
    function refresh() {
      var r = chosen ? rule(chosen) : null;
      $("#hint", form).textContent = r ? r.hint : "";
      $("#timebox", form).hidden = !r || r.time === "none";
      $("#timelabel", form).textContent = r && r.time === "required" ? "幾點再打（一定要揀）" : "回撥時間（可以唔揀）";
      if (r && r.time === "none") $("#callback", form).value = "";
      $("#otherbox", form).hidden = chosen !== "其他人跟進";
      save.disabled = !chosen;
      save.textContent = chosen ? "記低：" + chosen : "揀咗結果先記低";
    }
    $$("[data-outcome]", form).forEach(function (b) {
      b.addEventListener("click", function () {
        chosen = b.getAttribute("data-outcome");
        $$("[data-outcome]", form).forEach(function (x) { x.classList.toggle("on", x === b); });
        refresh();
      });
    });
    $$("[data-time]", form).forEach(function (b) {
      b.addEventListener("click", function () { $("#callback", form).value = b.getAttribute("data-time"); });
    });
    $("#isD", form).addEventListener("change", function () { $("#dbox", form).hidden = !$("#isD", form).checked; });
    // 填咗任何 D 資料就自動剔 D（server 都會再保一次）
    ["#dEnd", "#dProvider", "#dPrice", "#dPlan"].forEach(function (s) {
      $(s, form).addEventListener("input", function () { if ($(s, form).value.trim()) $("#isD", form).checked = true; });
    });
    save.addEventListener("click", function () {
      var err = $("#callerr", form);
      err.hidden = true;
      var r = rule(chosen);
      var cb = $("#callback", form).value;
      var other = $("#other", form).value.trim();
      var problem = !chosen ? "揀結果先" :
        r.time === "required" && !cb ? "「" + chosen + "」一定要揀時間" :
        chosen === "其他人跟進" && !other ? "填埋邊個同事跟緊" :
        !Number($("#attempt", form).value) ? "第幾次致電要係數字" : "";
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      var body = {
        companyId: d.company.id, outcome: chosen,
        attemptNo: Number($("#attempt", form).value),
        callbackAt: r.time === "none" ? null : (cb || null),
        content: $("#content", form).value.trim() || null,
        reachedR: $("#isR", form).checked, gotD: $("#isD", form).checked,
        dContractEnd: $("#dEnd", form).value || null, dProvider: $("#dProvider", form).value.trim() || null,
        dPrice: $("#dPrice", form).value.trim() || null, dPlan: $("#dPlan", form).value.trim() || null,
        otherFollower: chosen === "其他人跟進" ? other : null,
        phoneDialed: $("#dialed", form) ? $("#dialed", form).value : (d.phones.filter(function (p) { return p.label !== "傳真"; })[0] || {}).phone || null,
      };
      save.disabled = true;
      save.textContent = "記緊…";
      api("/calls", body).then(function (res) {
        var bits = ["記低咗：第 " + res.call.attempt_no + " 次 · " + res.call.outcome];
        if (res.statusBefore !== res.statusAfter) bits.push(res.statusBefore + " → " + res.statusAfter);
        if (res.closedTasks) bits.push("收咗 " + res.closedTasks + " 個舊提醒");
        if (res.task) bits.push("開咗" + res.task.kind + (res.task.due_at ? " " + fmt(res.task.due_at) : "（冇時間）"));
        toast(bits.join(" · "));
        render();
      }).catch(function (e) {
        save.disabled = false;
        refresh();
        err.textContent = e.message;
        err.hidden = false;
      });
    });
  }

  /**
   * 備註記錄（Kevin 2026-10-16 跟公司 MIS 個 Remark Record）：頂一格寫新備註，
   * 下面備註同電話記錄合埋一條時間線，最新喺頂。
   * 名單匯入嗰啲冇真日期 —— 排喺最底，寫明「原日期不明」，唔扮有時間。
   */
  function timelineCard(d) {
    var items = d.calls.map(function (k) { return { t: new Date(k.called_at).getTime(), html: callHtml(k) }; })
      .concat((d.remarks || []).map(function (r) {
        return { t: r.source === "import" ? -Infinity : new Date(r.created_at).getTime(), html: remarkHtml(r) };
      }));
    items.sort(function (a, b) { return b.t - a.t; });
    return '<div class="card" id="timeline"><h2 style="margin-top:0">備註記錄（' + items.length + "）</h2>" +
      '<div class="newremark"><textarea id="rmBody" rows="2" placeholder="新備註：例如「前台話 Leo 放假，下星期再打」"></textarea>' +
      '<button class="btn primary" id="rmSave" disabled>加</button></div>' +
      (items.length ? items.map(function (x) { return x.html; }).join("") : '<p class="muted">未打過、未有備註</p>') + "</div>";
  }

  function remarkHtml(r) {
    var when = r.source === "import" ? "名單匯入（原日期不明）" : fmt(r.created_at);
    return '<div class="remark" data-remark="' + esc(r.id) + '"><div class="spread"><span><b>' + esc(when) + "</b> " +
      (r.source === "import" ? "" : '<span class="muted small">' + esc(r.author) + "</span>") + "</span>" +
      '<button class="btn sm danger" data-act="del-remark">刪</button></div>' +
      '<div class="pre">' + esc(r.body) + "</div></div>";
  }

  function callHtml(k) {
    var dBits = [k.d_provider, k.d_contract_end ? "約滿 " + k.d_contract_end : "", k.d_price, k.d_plan].filter(Boolean);
    return '<div class="call" data-call="' + esc(k.id) + '"><div class="spread"><span><b>' + esc(fmt(k.called_at)) + "</b> 第 " + k.attempt_no + " 次 " +
      '<span class="pill ' + (k.outcome === "沒有人接" ? "" : "acc") + '">' + esc(k.outcome) + "</span> " + rd(k.reached_r, k.got_d) + "</span>" +
      '<span class="row"><button class="btn sm" data-act="edit">改</button><button class="btn sm danger" data-act="del">刪</button></span></div>' +
      (k.callback_at ? '<div class="small muted">約咗 ' + esc(fmt(k.callback_at)) + "</div>" : "") +
      (k.other_follower ? '<div class="small">同事：' + esc(k.other_follower) + "</div>" : "") +
      (dBits.length ? '<div class="small" style="color:var(--d)">D：' + esc(dBits.join(" · ")) + "</div>" : "") +
      (k.content ? '<div class="pre">' + esc(k.content) + "</div>" : "") +
      '<div class="edit" hidden><textarea data-e="content">' + esc(k.content || "") + "</textarea>" +
      '<div class="row" style="margin:6px 0"><label class="check"><input type="checkbox" data-e="reachedR"' + (k.reached_r ? " checked" : "") + "> R</label>" +
      '<label class="check"><input type="checkbox" data-e="gotD"' + (k.got_d ? " checked" : "") + "> D</label></div>" +
      '<div class="grid2"><label class="f"><span>合約到期日</span><input type="date" data-e="dContractEnd" value="' + esc(k.d_contract_end || "") + '"></label>' +
      '<label class="f"><span>用緊邊個台</span><input type="text" data-e="dProvider" value="' + esc(k.d_provider || "") + '"></label>' +
      '<label class="f"><span>而家價錢</span><input type="text" data-e="dPrice" value="' + esc(k.d_price || "") + '"></label>' +
      '<label class="f"><span>套餐內容</span><input type="text" data-e="dPlan" value="' + esc(k.d_plan || "") + '"></label></div>' +
      '<div class="small muted">結果改唔到 —— 揀錯就刪咗再記過（舊提醒會跟住返嚟）。</div>' +
      '<button class="btn sm primary" data-act="edit-save">存</button></div></div>';
  }

  function viewCompany(id) {
    return Promise.all([meta(), api("/companies/" + encodeURIComponent(id))]).then(function (x) {
      var d = x[1];
      var c = d.company;
      var faxes = d.phones.filter(function (p) { return p.label === "傳真"; });
      var mine = {};
      d.products.forEach(function (p) { mine[p.id] = true; });
      var html = '<div class="spread"><div><h1>' + esc(nameOf(c)) + "</h1>" +
        (altName(c) ? '<div class="muted">' + esc(altName(c)) + "</div>" : "") + "</div>" +
        '<div class="row">' + statusPill(c.status) + rd(c.ever_r, c.ever_d) + ' <span class="muted small">' + esc(c.code) + "</span></div></div>" +
        '<div class="card"><div class="dials">' +
        d.phones.filter(function (p) { return p.label !== "傳真"; }).map(function (p) {
          return dialLink(p.phone, p.label !== "總機" ? p.label : "");
        }).join("") + "</div><div class=\"phones\">" +
        (faxes.length ? faxes.map(function (p) { return '<span class="muted small">傳真 ' + esc(p.phone.slice(0, 4) + " " + p.phone.slice(4)) + "</span>"; }).join(" ") : "") +
        (d.phones.length ? "" : '<span class="muted">冇電話</span>') + "</div>" +
        (d.emails.length ? '<div class="small">' + d.emails.map(function (e) { return '<a href="mailto:' + esc(e.email) + '">' + esc(e.email) + "</a>"; }).join(" · ") + "</div>" : "") +
        (c.address_zh || c.address_en ? '<div class="small muted">' + esc([c.address_zh, c.address_en].filter(Boolean).join(" / ")) + "</div>" : "") +
        '<div class="small muted">' + esc([c.industry, c.customer_type === "個人" ? "個人客" : "", c.br_no ? "BR " + c.br_no : "", c.website].filter(Boolean).join(" · ")) + "</div>" +
        (c.followed_by ? '<div class="note">' + esc(c.followed_by) + " 跟緊 —— 唔好撞單</div>" : "") +
        '<div class="row" style="margin-top:8px"><label class="check"><input type="checkbox" id="mis"' + (c.mis_checked ? " checked" : "") + "> MIS 查過（唔係現有客）</label></div></div>";

      html += callForm(d);
      html += timelineCard(d);
      html += bookingCard(d);

      html += '<div class="card"><h2 style="margin-top:0">有興趣嘅產品</h2><div class="chips" id="prods">' +
        META.products.map(function (p) {
          return '<button type="button" data-p="' + esc(p.id) + '" class="' + (mine[p.id] ? "on" : "") + '">' + esc(p.name) + "</button>";
        }).join("") + "</div></div>";

      if (d.tasks.length) {
        var nowMs = Date.now();
        html += '<div class="card"><h2 style="margin-top:0">未完成</h2>' + d.tasks.map(function (t) {
          return taskRow({ id: t.id, kind: t.kind, due_at: t.due_at, note: t.note,
            overdue: !!t.due_at && new Date(t.due_at).getTime() < nowMs }, true);
        }).join("") + "</div>";
      }

      html += '<div class="card"><h2 style="margin-top:0">聯絡人</h2><div id="contacts">' +
        (d.contacts.length ? d.contacts.map(function (p) {
          return '<div class="item" data-contact="' + esc(p.id) + '"><div class="spread"><span class="name">' + esc(p.name) +
            (p.is_decision_maker ? ' <span class="pill r">負責人</span>' : "") + "</span>" +
            '<button class="btn sm danger" data-act="del-contact">刪</button></div>' +
            '<div class="small">' + esc([p.title, p.phone, p.email].filter(Boolean).join(" · ")) + "</div>" +
            (p.notes ? '<div class="small muted pre">' + esc(p.notes) + "</div>" : "") + "</div>";
        }).join("") : '<p class="muted">未有</p>') + "</div>" +
        '<details><summary>＋加聯絡人</summary><div class="grid2">' +
        '<label class="f"><span>名</span><input type="text" id="ctName"></label>' +
        '<label class="f"><span>職位</span><input type="text" id="ctTitle"></label>' +
        '<label class="f"><span>電話</span><input type="text" id="ctPhone"></label>' +
        '<label class="f"><span>電郵</span><input type="email" id="ctEmail"></label></div>' +
        '<label class="check"><input type="checkbox" id="ctDM"> 負責人（R）</label> ' +
        '<button class="btn sm primary" id="ctSave">加</button></details></div>';

      html += '<div class="card"><details><summary>改公司資料</summary>' + companyFormHtml({
        name_zh: c.name_zh, name_en: c.name_en, industry: c.industry, address_zh: c.address_zh, address_en: c.address_en,
        br_no: c.br_no, website: c.website, notes: c.notes, phonesText: phonesToText(d.phones),
        emailsText: d.emails.map(function (e) { return e.email; }).join(" / "), customer_type: c.customer_type,
        status: c.status, followed_by: c.followed_by,
      }, true) + '<button class="btn primary" id="coSave">存</button><div id="coErr" class="err" hidden></div></details>' +
        '<div class="row" style="margin-top:8px"><button class="btn sm danger" id="coDelete">刪除呢間公司</button>' +
        '<span class="small muted">有電話記錄或者約見面嘅唔刪得（改狀態就得）</span></div>' +
        (c.source ? '<div class="small muted">來源：' + esc(c.source) + "</div>" : "") + "</div>";

      view().innerHTML = html;
      wireCallForm(d);
      wireBooking(d);
      wireAppts(view(), render);
      wireTasks(view(), render);

      $("#mis").addEventListener("change", function () {
        api("/companies/" + c.id, { mis_checked: $("#mis").checked })
          .then(function () { toast($("#mis").checked ? "標咗 MIS 查過" : "改返 MIS 未查"); })
          .catch(function (e) { toast(e.message, true); });
      });
      $$("#prods [data-p]").forEach(function (b) {
        b.addEventListener("click", function () {
          b.classList.toggle("on");
          var ids = $$("#prods [data-p].on").map(function (x) { return x.getAttribute("data-p"); });
          api("/companies/" + c.id, { productIds: ids }).then(function () { toast("興趣產品存咗"); })
            .catch(function (e) { b.classList.toggle("on"); toast(e.message, true); });
        });
      });
      $$("[data-call]").forEach(function (row) {
        var cid = row.getAttribute("data-call");
        row.addEventListener("click", function (e) {
          var b = e.target.closest("[data-act]");
          if (!b) return;
          var act = b.getAttribute("data-act");
          if (act === "edit") { $(".edit", row).hidden = !$(".edit", row).hidden; return; }
          if (act === "del") {
            if (!confirm("刪咗呢次電話記錄？（佢收咗嘅舊提醒會返嚟，佢開嘅新提醒會一齊刪）")) return;
            api("/calls/" + cid + "/delete", {}).then(function () { toast("刪咗"); render(); }).catch(function (er) { toast(er.message, true); });
            return;
          }
          if (act === "edit-save") {
            var v = function (k) { return $('[data-e="' + k + '"]', row); };
            api("/calls/" + cid, {
              content: v("content").value.trim() || null, reachedR: v("reachedR").checked, gotD: v("gotD").checked,
              dContractEnd: v("dContractEnd").value || null, dProvider: v("dProvider").value.trim() || null,
              dPrice: v("dPrice").value.trim() || null, dPlan: v("dPlan").value.trim() || null,
            }).then(function () { toast("改咗"); render(); }).catch(function (er) { toast(er.message, true); });
          }
        });
      });
      var rmBody = $("#rmBody"), rmSave = $("#rmSave");
      rmBody.addEventListener("input", function () { rmSave.disabled = !rmBody.value.trim(); });
      rmSave.addEventListener("click", function () {
        rmSave.disabled = true;
        api("/companies/" + c.id + "/remarks", { body: rmBody.value })
          .then(function () { toast("加咗備註"); render(); })
          .catch(function (er) { rmSave.disabled = false; toast(er.message, true); });
      });
      $$("[data-remark]").forEach(function (row) {
        $('[data-act="del-remark"]', row).addEventListener("click", function () {
          if (!confirm("刪咗呢條備註？")) return;
          api("/remarks/" + row.getAttribute("data-remark") + "/delete", {}).then(function () { toast("刪咗"); render(); })
            .catch(function (er) { toast(er.message, true); });
        });
      });
      $$("[data-contact]").forEach(function (row) {
        $('[data-act="del-contact"]', row).addEventListener("click", function () {
          if (!confirm("刪咗呢個聯絡人？")) return;
          api("/contacts/" + row.getAttribute("data-contact") + "/delete", {}).then(function () { toast("刪咗"); render(); })
            .catch(function (er) { toast(er.message, true); });
        });
      });
      $("#ctSave").addEventListener("click", function () {
        api("/companies/" + c.id + "/contacts", {
          name: $("#ctName").value.trim(), title: $("#ctTitle").value.trim() || null, phone: $("#ctPhone").value.trim() || null,
          email: $("#ctEmail").value.trim() || null, is_decision_maker: $("#ctDM").checked,
        }).then(function () { toast("加咗聯絡人"); render(); }).catch(function (er) { toast(er.message, true); });
      });
      $("#coDelete").addEventListener("click", function () {
        if (!confirm("刪除「" + nameOf(c) + "」（" + c.code + "）？\n佢嘅電話、電郵、聯絡人、備註會一齊刪，冇得返轉頭。")) return;
        api("/companies/" + c.id + "/delete", {}).then(function (r) {
          toast("刪咗 " + r.deleted.code + " " + r.deleted.name);
          meta(true);
          location.hash = "#/companies";
        }).catch(function (er) { toast(er.message, true); });
      });
      $("#coSave").addEventListener("click", function () {
        var body = readCompanyForm(view(), true);
        api("/companies/" + c.id, body).then(function () { toast("存咗"); meta(true); render(); })
          .catch(function (er) { $("#coErr").textContent = er.message; $("#coErr").hidden = false; });
      });
    });
  }

  // ── 公司頁：約見面 ──────────────────────────────────────────────────────
  function bookingCard(d) {
    var c = d.company;
    var addr = c.address_zh || c.address_en || "";
    var appts = d.appointments || [];
    return '<div class="card" id="apptCard"><h2 style="margin-top:0">預約見面（' + appts.length + "）</h2>" +
      appts.map(function (a) { return apptCard(a, { withDate: true, noCompany: true }); }).join("") +
      '<details id="bookBox"' + (appts.length ? "" : " open") + '><summary>＋約見面</summary>' +
      '<label class="f"><span>幾時</span><input type="datetime-local" id="bkAt"></label>' +
      '<div class="quick">' + quickTimes(META.today).slice(2).map(function (q) {
        return '<button type="button" class="btn sm" data-bktime="' + esc(q[1]) + '">' + esc(q[0]) + "</button>";
      }).join("") + "</div>" +
      '<div class="grid2"><label class="f"><span>見幾耐</span><select id="bkMin">' +
      [30, 45, 60, 90, 120].map(function (m) { return '<option value="' + m + '"' + (m === 60 ? " selected" : "") + ">" + (m < 60 ? m + " 分鐘" : m / 60 + " 個鐘") + "</option>"; }).join("") +
      '</select></label><label class="f"><span>見邊個</span><select id="bkContact"><option value="">（未知／唔指定）</option>' +
      d.contacts.map(function (k) { return opt(k.id, k.name + (k.title ? "（" + k.title + "）" : ""), ""); }).join("") +
      '<option value="__new">＋新聯絡人…</option></select></label></div>' +
      '<div id="bkNew" class="grid2" hidden><label class="f"><span>名</span><input type="text" id="bkName"></label>' +
      '<label class="f"><span>職位</span><input type="text" id="bkTitle"></label>' +
      '<label class="f"><span>電話</span><input type="text" id="bkPhone"></label></div>' +
      '<label class="f"><span>地址（預設公司地址，可以改）</span><input type="text" id="bkAddr" value="' + esc(addr) + '"></label>' +
      '<label class="f"><span>目的／準備</span><input type="text" id="bkPurpose" placeholder="例：介紹 SME Bundle，帶報價"></label>' +
      '<div id="bkErr" class="err" hidden></div><button class="btn primary" id="bkSave">約</button></details></div>';
  }

  function wireBooking(d) {
    var box = $("#bookBox");
    if (!box) return;
    $$("[data-bktime]", box).forEach(function (b) {
      b.addEventListener("click", function () { $("#bkAt").value = b.getAttribute("data-bktime"); });
    });
    $("#bkContact").addEventListener("change", function () { $("#bkNew").hidden = $("#bkContact").value !== "__new"; });
    $("#bkSave").addEventListener("click", function () {
      var err = $("#bkErr");
      err.hidden = true;
      var at = $("#bkAt").value;
      var who = $("#bkContact").value;
      var name = $("#bkName").value.trim();
      var problem = !at ? "揀幾時見" : who === "__new" && !name ? "新聯絡人要有名" : "";
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      var body = {
        companyId: d.company.id, startsAt: at, minutes: Number($("#bkMin").value),
        contactId: who && who !== "__new" ? who : null,
        newContact: who === "__new" ? { name: name, title: $("#bkTitle").value.trim() || null, phone: $("#bkPhone").value.trim() || null } : null,
        address: $("#bkAddr").value.trim() || null, purpose: $("#bkPurpose").value.trim() || null,
      };
      $("#bkSave").disabled = true;
      api("/appointments", body).then(function (r) {
        var clash = r.clashes.length ? " ⚠️ 同 " + r.clashes.map(function (c) { return hhmm(c.starts_at) + " " + c.company_name; }).join("、") + " 好近" : "";
        toast("約咗 " + fmt(r.appointment.starts_at) + clash);
        render();
      }).catch(function (e) { $("#bkSave").disabled = false; err.textContent = e.message; err.hidden = false; });
    });
  }

  // ── 公司表格（開新／改共用）──────────────────────────────────────────────
  function companyFormHtml(v, withStatus) {
    var t = function (k, label, ph) {
      return '<label class="f"><span>' + label + '</span><input type="text" data-c="' + k + '" value="' + esc(v[k] || "") + '"' +
        (ph ? ' placeholder="' + esc(ph) + '"' : "") + "></label>";
    };
    return '<div class="grid2">' + t("name_zh", "中文名") + t("name_en", "英文名") +
      t("phonesText", "電話（幾個都得，用 / 分）", "2345 6789 / 傳真 2345 6790 / 手提 9123 4567") +
      t("emailsText", "電郵（幾個都得）", "info@abc.com / sales@abc.com") +
      t("industry", "行業") + t("br_no", "BR 號碼") + t("address_zh", "中文地址") + t("address_en", "英文地址") + t("website", "網站") +
      '<label class="f"><span>客戶類型</span><select data-c="customer_type">' + opt("公司", "公司", v.customer_type || "公司") + opt("個人", "個人", v.customer_type || "公司") + "</select></label>" +
      (withStatus ? '<label class="f"><span>狀態</span><select data-c="status">' + META.statuses.map(function (s) { return opt(s, s, v.status); }).join("") + "</select></label>" +
        t("followed_by", "其他同事跟緊（填咗就唔出冷電名單）") : "") +
      '</div><label class="f"><span>備註</span><textarea data-c="notes">' + esc(v.notes || "") + "</textarea></label>";
  }
  function readCompanyForm(root, withStatus) {
    var o = {};
    $$("[data-c]", root).forEach(function (el) {
      var k = el.getAttribute("data-c");
      if (!withStatus && (k === "status" || k === "followed_by")) return;
      o[k] = el.value.trim();
    });
    return o;
  }

  function viewNew() {
    return meta().then(function () {
      view().innerHTML = '<h1>新增公司</h1><div class="card" id="newform">' + companyFormHtml({}, false) +
        '<div id="dups"></div><div id="newErr" class="err" hidden></div>' +
        '<button class="btn primary" id="create">開</button></div>';
      function go(force) {
        var body = readCompanyForm($("#newform"), false);
        body.force = force;
        $("#newErr").hidden = true;
        api("/companies", body).then(function (r) {
          if (r.created) { toast("開咗 " + r.created.code); meta(true); location.hash = "#/c/" + r.created.id; return; }
          $("#dups").innerHTML = '<div class="note">好似已經有：' + r.duplicates.map(function (h) {
            return '<div><a href="#/c/' + esc(h.id) + '">' + esc(h.code + " " + h.name) + "</a> —— " + esc(h.why) + "</div>";
          }).join("") + '<button class="btn sm" id="force" style="margin-top:6px">唔係，係另一間，照開</button></div>';
          $("#force").addEventListener("click", function () { go(true); });
        }).catch(function (e) { $("#newErr").textContent = e.message; $("#newErr").hidden = false; });
      }
      $("#create").addEventListener("click", function () { go(false); });
    });
  }

  // ── 撳個數睇係邊幾間（Kevin 2026-10-16「要能夠點開顯示什麼公司」）────────────
  var DETAIL_LABEL = { calls: "通數", connected: "接通", r: "R 負責人", d: "D 詳盡資料", booked: "約", met: "見" };
  function detailHref(kind, from, to) {
    return "#/stats/detail?kind=" + kind + "&from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
  }
  /** 表入面嘅數：0 就照寫 0（冇嘢好睇），有數先撳得 */
  function detailLink(kind, from, to, n) {
    return n ? '<a href="' + detailHref(kind, from, to) + '">' + n + "</a>" : String(n);
  }
  /** 六格數（今日／本星期／揀日子共用），每格撳入去睇係邊幾間 */
  function statTiles(t, from, to, labels, keyed) {
    var cls = { calls: "", connected: "", r: " r", d: " d", booked: " a", met: " a" };
    return '<div class="stats six">' + ["calls", "connected", "r", "d", "booked", "met"].map(function (k) {
      return '<a class="stat' + cls[k] + '" href="' + detailHref(k, from, to) + '"><b' + (keyed ? ' data-k="' + k + '"' : "") + ">" + t[k] +
        "</b><span>" + esc((labels && labels[k]) || DETAIL_LABEL[k]) + "</span></a>";
    }).join("") + "</div>";
  }

  function viewStatsDetail() {
    var p = new URLSearchParams(location.hash.split("?")[1] || "");
    var kind = p.get("kind") || "calls", from = p.get("from") || META.today, to = p.get("to") || from;
    return api("/stats/detail?kind=" + encodeURIComponent(kind) + "&from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to)).then(function (d) {
      var when = from === to ? fmtDay(from) : fmtDay(from) + " 至 " + fmtDay(to);
      var perCo = kind === "r" || kind === "d";
      var appt = kind === "booked" || kind === "met";
      view().innerHTML = '<div class="spread"><h1>' + esc(DETAIL_LABEL[kind] || kind) + "：" + esc(when) + "（" + d.rows.length + "）</h1>" +
        '<button class="btn sm" id="back">← 返轉頭</button></div>' +
        '<div class="row" style="margin-bottom:10px">' + ["calls", "connected", "r", "d", "booked", "met"].map(function (k) {
          return '<a class="btn sm' + (k === kind ? " primary" : "") + '" href="' + detailHref(k, from, to) + '">' + esc(DETAIL_LABEL[k]) + "</a>";
        }).join("") + "</div>" +
        (perCo ? '<p class="small muted">按間數：同一間打幾次都係一行（顯示最後嗰次）。</p>' : "") +
        (kind === "booked" ? '<p class="small muted">嗰日約咗嘅（取消咗唔計），時間係見面時間。</p>' : "") +
        '<div class="card" id="detail">' + (d.rows.length ? d.rows.map(function (r) {
          return '<a class="item" href="#/c/' + esc(r.company_id) + '"><div class="spread"><span class="name">' + esc(r.name) + "</span>" +
            '<span class="small muted">' + esc(r.code) + "</span></div>" +
            '<div class="row small"><b>' + esc(fmt(r.at)) + "</b>" +
            (r.attempt_no ? ' <span class="muted">第 ' + r.attempt_no + " 次</span>" : "") +
            ' <span class="pill ' + (r.tag === "沒有人接" ? "" : "acc") + '">' + esc(r.tag) + "</span>" +
            (appt ? "" : " " + rd(r.reached_r, r.got_d)) +
            (r.extra ? ' <span class="muted">' + esc(appt ? r.extra : "D：" + r.extra) + "</span>" : "") + "</div>" +
            (r.text ? '<div class="small pre">' + esc(r.text) + "</div>" : "") + "</a>";
        }).join("") : '<p class="muted">冇</p>') + "</div>";
      $("#back").addEventListener("click", function () { if (history.length > 1) history.back(); else location.hash = "#/"; });
    });
  }

  // ── 數 ──────────────────────────────────────────────────────────────────
  function viewStats() {
    var p = new URLSearchParams(location.hash.split("?")[1] || "");
    var to = p.get("to") || (META && META.today) || "";
    var from = p.get("from") || (to ? addDays(to, -29) : "");
    return api("/stats?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to)).then(function (d) {
      var box = function (t, from, to) { return statTiles(t, from, to, { r: "R（間）", d: "D（間）" }, false); };
      var w = d.week;
      view().innerHTML = '<h1>每日數</h1>' +
        '<h2 id="weekTitle">本星期（' + esc(fmtDay(w.from)) + " 至 " + esc(fmtDay(w.to)) + "）</h2>" + '<div id="week">' + box(w, w.from, w.to) + "</div>" +
        '<h2>揀日子</h2><div class="row" style="margin-bottom:10px">' +
        '<input type="date" id="from" value="' + esc(d.from) + '" style="width:auto"> 至 ' +
        '<input type="date" id="to" value="' + esc(d.to) + '" style="width:auto"> <button class="btn sm" id="go">睇</button></div>' +
        box(d.totals, d.from, d.to) + '<div class="small muted" style="margin-bottom:8px">R、D 按間數：同一間一段時間 R 咗幾次都算 1。約＝嗰日約咗幾多個（取消咗唔計）；見＝嗰日見咗幾多個。</div>' +
        '<div class="card scroll"><table><thead><tr><th>日子</th><th class="num">通數</th><th class="num">接通</th><th class="num">接通率</th><th class="num">R</th><th class="num">D</th><th class="num">約</th><th class="num">見</th></tr></thead><tbody>' +
        d.days.map(function (h) {
          var n = function (k) { return '<td class="num">' + detailLink(k, h.day, h.day, h[k]) + "</td>"; };
          return "<tr><td>" + esc(fmtDay(h.day)) + "</td>" + n("calls") + n("connected") + '<td class="num">' +
            (h.calls ? Math.round((h.connected / h.calls) * 100) + "%" : "—") + "</td>" + n("r") + n("d") + n("booked") + n("met") + "</tr>";
        }).join("") + "</tbody></table></div>";
      $("#go").addEventListener("click", function () {
        location.hash = "#/stats?from=" + $("#from").value + "&to=" + $("#to").value;
      });
    });
  }

  // ── 日曆：時間表（預設）＋ 月曆 ──────────────────────────────────────────
  var ACTIVE = "已約,已見,冇出現";

  function viewCalendar() {
    var p = new URLSearchParams(location.hash.split("?")[1] || "");
    var today = META.today;
    var mode = p.get("view") === "month" ? "month" : "list";
    var tabs = '<div class="row" style="margin-bottom:10px">' +
      '<a class="btn sm' + (mode === "list" && !p.get("past") && !p.get("day") ? " primary" : "") + '" href="#/calendar">時間表</a>' +
      '<a class="btn sm' + (mode === "month" ? " primary" : "") + '" href="#/calendar?view=month">月曆</a>' +
      '<a class="btn sm' + (p.get("past") ? " primary" : "") + '" href="#/calendar?past=1">之前 30 日</a></div>';

    if (mode === "month") {
      var ym = p.get("m") || today.slice(0, 7);
      var first = ym + "-01";
      var next = addDays(first, 32).slice(0, 7) + "-01";
      var last = addDays(next, -1);
      var prev = addDays(first, -1).slice(0, 7);
      return api("/appointments?from=" + first + "&to=" + last + "&status=" + encodeURIComponent(ACTIVE)).then(function (r) {
        var count = {};
        r.rows.forEach(function (a) { var k = hkDayOf(a.starts_at); count[k] = (count[k] || 0) + 1; });
        var lead = (dayOfWeek(first) + 6) % 7; // 星期一開頭
        var cells = "";
        for (var i = 0; i < lead; i++) cells += '<div class="mday empty"></div>';
        for (var day = first; day <= last; day = addDays(day, 1)) {
          var n = count[day] || 0;
          cells += '<a class="mday' + (day === today ? " today" : "") + (n ? " has" : "") + '" href="#/calendar?day=' + day + '" data-day="' + day + '">' +
            '<span class="dnum">' + Number(day.slice(8)) + "</span>" + (n ? '<span class="dcount">' + n + " 個約</span>" : "") + "</a>";
        }
        view().innerHTML = '<h1>日曆</h1>' + tabs +
          '<div class="spread"><a class="btn sm" href="#/calendar?view=month&m=' + prev + '">‹ 上個月</a>' +
          '<h2 style="margin:0">' + Number(ym.slice(0, 4)) + " 年 " + Number(ym.slice(5)) + " 月</h2>" +
          '<a class="btn sm" href="#/calendar?view=month&m=' + next.slice(0, 7) + '">下個月 ›</a></div>' +
          '<div class="month"><div class="mhead">一</div><div class="mhead">二</div><div class="mhead">三</div><div class="mhead">四</div>' +
          '<div class="mhead">五</div><div class="mhead">六</div><div class="mhead">日</div>' + cells + "</div>";
      });
    }

    var from, to, statuses, title;
    if (p.get("day")) { from = to = p.get("day"); statuses = ACTIVE + ",取消"; title = fmtDay(from); }
    else if (p.get("past")) { from = addDays(today, -30); to = addDays(today, -1); statuses = ACTIVE + ",取消"; title = "之前 30 日"; }
    else { from = today; to = addDays(today, 30); statuses = ACTIVE; title = "由今日起 30 日"; }
    return api("/appointments?from=" + from + "&to=" + to + "&status=" + encodeURIComponent(statuses)).then(function (r) {
      var rows = p.get("past") ? r.rows.slice().reverse() : r.rows;
      var groups = [];
      rows.forEach(function (a) {
        var k = hkDayOf(a.starts_at);
        var g = groups[groups.length - 1];
        if (!g || g.day !== k) groups.push(g = { day: k, items: [] });
        g.items.push(a);
      });
      view().innerHTML = '<h1>日曆</h1>' + tabs + '<div class="small muted" style="margin-bottom:8px">' + esc(title) + " · 共 " + rows.length + " 個約</div>" +
        (groups.length ? groups.map(function (g) {
          return '<div class="card"><h2 class="dayhead" style="margin-top:0">' + esc(fmtDay(g.day)) + (g.day === today ? ' <span class="pill acc">今日</span>' : "") +
            ' <span class="small muted">' + g.items.length + " 個</span></h2>" + g.items.map(function (a) { return apptCard(a); }).join("") + "</div>";
        }).join("") : '<div class="card"><p class="muted">冇約。喺公司頁撳「＋約見面」，或者同 Claude 講「約咗 XX 公司下星期二 3 點」。</p></div>');
      wireAppts(view(), render);
    });
  }

  // ── 更多：匯入、產品、登出 ────────────────────────────────────────────────
  function viewMore() {
    view().innerHTML = '<h1>更多</h1><div class="card">' +
      '<a class="item" href="#/new"><span class="name">＋新增公司</span></a>' +
      '<a class="item" href="#/import"><span class="name">匯入公司名單</span><div class="small muted">Excel（.xlsx）或者 CSV</div></a>' +
      '<a class="item" href="#/products"><span class="name">產品</span><div class="small muted">加產品、改名、停用、預設月費</div></a>' +
      '<a class="item" href="/app/api/companies.xlsx"><span class="name">導出全部公司（Excel）</span></a>' +
      '<form method="post" action="/app/logout" class="item"><button class="btn danger">登出</button></form></div>';
    return Promise.resolve();
  }

  var FIELD_LABEL = {
    name: "公司名（有中文當中文名）", name_zh: "中文名", name_en: "英文名", phone: "電話", fax: "傳真", mobile: "手提",
    direct: "直線", email: "電郵", address: "地址（有中文當中文）", address_zh: "中文地址", address_en: "英文地址",
    industry: "行業", website: "網站", br_no: "BR", notes: "備註", customer_type: "客戶類型",
    result: "聯絡結果（原文入備註記錄）", followup: "補充跟進（入備註記錄）",
  };
  var STATUS_ORDER = ["未打", "跟進中", "不需要", "其他人跟進", "已成交", "已結業"];

  /**
   * 匯入預覽：之前打過嘅狀態幾多間；聯絡結果認唔到嘅逐行列出嚟（Kevin：「不明的問我 不要自己加狀態」）。
   */
  function importStatusHtml(p) {
    var bs = p.byStatus || {};
    var keys = STATUS_ORDER.filter(function (k) { return bs[k]; });
    if (!(p.unknownResults || []).length && !(p.conflicts || []).length && keys.length <= 1) return "";
    var list = function (rows) {
      return rows.map(function (u) {
        return '<div class="item small"><b>第 ' + u.line + " 行</b> " + esc(u.name) + ' <span class="muted">「' + esc(u.text) + "」</span></div>";
      }).join("");
    };
    return '<h2>狀態（入咗之後）</h2><div class="chips" id="impStatus">' + keys.map(function (k) {
      return '<span class="pill' + (k === "未打" ? "" : " acc") + '" data-st="' + esc(k) + '">' + esc(k) + " " + bs[k] + "</span>";
    }).join(" ") + "</div>" +
      '<p class="small muted">「聯絡結果」嗰欄嘅原文全部入公司嘅備註記錄（寫「名單匯入，原日期不明」）。</p>' +
      ((p.unknownResults || []).length ? '<div class="note" id="impUnknown"><b>' + p.unknownResults.length +
        " 行嘅聯絡結果認唔到</b> —— 唔會自己加狀態，入做「未打」，原文照入備註記錄。逐間話我知要標咩。" +
        list(p.unknownResults) + "</div>" : "") +
      ((p.conflicts || []).length ? '<div class="note" id="impConflict"><b>' + p.conflicts.length +
        " 間公司喺檔案出現兩次、兩個結果唔同</b> —— 入做「未打」，兩個原文都入備註記錄。" + list(p.conflicts) + "</div>" : "");
  }

  function viewImport() {
    view().innerHTML = '<h1>匯入公司名單</h1><div class="card">' +
      '<p class="small muted">Excel（.xlsx）或 CSV，第一行係標題。認得：中文名、英文名、公司名稱、電話（幾欄都得）、傳真、手提、電郵、中英文地址、行業、網站、BR、備註。認唔到嘅欄會寫落備註，唔會丟。</p>' +
      '<input type="file" id="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">' +
      '<label class="check" style="margin-top:8px"><input type="checkbox" id="clash"> 電話撞咗現有公司都照入（同集團共用總機）</label>' +
      '<div id="preview"></div></div>';
    var file = null;
    function q(commit) {
      return "/import/" + (commit ? "commit" : "preview") + "?filename=" + encodeURIComponent(file.name) + ($("#clash").checked ? "&allowPhoneClash=1" : "");
    }
    function preview() {
      if (!file) return;
      $("#preview").innerHTML = '<p class="muted">睇緊…</p>';
      upload(q(false), file).then(function (p) {
        var n = p.counts;
        $("#preview").innerHTML = '<h2>會點做</h2><div class="stats">' +
          '<div class="stat"><b>' + n.total + '</b><span>總行數</span></div><div class="stat"><b data-k="new">' + n.new + '</b><span>會入</span></div>' +
          '<div class="stat"><b>' + (n.existingName + n.existingPhone) + '</b><span>CRM 已經有</span></div><div class="stat"><b>' + (n.mergedInFile + n.noName) + '</b><span>檔內重複／冇名</span></div></div>' +
          importStatusHtml(p) +
          '<div class="scroll"><table><thead><tr><th>檔案欄</th><th>當做</th></tr></thead><tbody>' +
          p.headers.map(function (h, i) {
            var f = p.mapping[i];
            return "<tr><td>" + esc(h) + "</td><td>" + (f ? esc(FIELD_LABEL[f] || f) : '<span class="muted">（寫落備註）</span>') + "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          (p.sample.length ? '<h2>頭幾行會入成噉</h2>' + p.sample.map(function (s) {
            return '<div class="item"><span class="name">' + esc(s.name_zh || s.name_en) + "</span> " + (s.name_zh && s.name_en ? '<span class="muted small">' + esc(s.name_en) + "</span>" : "") +
              '<div class="small">' + esc(s.phones.join(" / ")) + (s.emails.length ? " · " + esc(s.emails.join(" / ")) : "") + (s.industry ? " · " + esc(s.industry) : "") + "</div></div>";
          }).join("") : "") +
          (p.issuesTotal ? '<details><summary>唔入／有警告嘅行（' + p.issuesTotal + "）</summary>" + p.issues.map(function (x) {
            return '<div class="item small"><b>第 ' + x.line + " 行</b> " + esc(x.name) + " " + (x.action === "skip" ? '<span class="pill bad">唔入</span> ' + esc(x.reason || "") : "") +
              (x.warnings.length ? '<div class="muted">' + x.warnings.map(esc).join("<br>") + "</div>" : "") + "</div>";
          }).join("") + (p.issuesTotal > p.issues.length ? '<div class="muted small">…淨係列頭 ' + p.issues.length + " 行</div>" : "") + "</details>" : "") +
          '<button class="btn primary block" id="commit" style="margin-top:12px"' + (n.new ? "" : " disabled") + ">確認匯入 " + n.new + " 間</button>";
        var b = $("#commit");
        if (b) b.addEventListener("click", function () {
          b.disabled = true;
          b.textContent = "匯入緊…";
          upload(q(true), file).then(function (r) {
            toast("入咗 " + r.created + " 間" + (r.firstCode ? "（" + r.firstCode + "–" + r.lastCode + "）" : ""));
            meta(true);
            location.hash = "#/companies?sort=created";
          }).catch(function (e) { b.disabled = false; b.textContent = "再試"; toast(e.message, true); });
        });
      }).catch(function (e) { $("#preview").innerHTML = '<div class="err">' + esc(e.message) + "</div>"; });
    }
    $("#file").addEventListener("change", function () { file = $("#file").files[0] || null; preview(); });
    $("#clash").addEventListener("change", preview);
    return Promise.resolve();
  }

  function viewProducts() {
    return api("/products?all=1").then(function (list) {
      var money = function (v) { return v === null || v === undefined ? "" : v; };
      view().innerHTML = '<h1>產品</h1><p class="small muted">月費、成本、期數係預設值（第三期出報價用），未知就留空。成本只會喺你自己度見到，唔會出喺報價單。</p>' +
        '<div class="card">' + list.map(function (p) {
          return '<div class="item" data-prod="' + esc(p.id) + '"><div class="spread"><span class="name">' + esc(p.name) +
            (p.active ? "" : ' <span class="pill">停用</span>') + '</span><span class="small muted">' + p.interested + " 間有興趣</span></div>" +
            '<details><summary class="small">改</summary><div class="grid2">' +
            '<label class="f"><span>名</span><input type="text" data-k="name" value="' + esc(p.name) + '"></label>' +
            '<label class="f"><span>類別</span><input type="text" data-k="category" value="' + esc(p.category || "") + '"></label>' +
            '<label class="f"><span>預設月費</span><input type="text" inputmode="decimal" data-k="default_monthly_fee" value="' + esc(money(p.default_monthly_fee)) + '"></label>' +
            '<label class="f"><span>成本（自己睇）</span><input type="text" inputmode="decimal" data-k="default_cost" value="' + esc(money(p.default_cost)) + '"></label>' +
            '<label class="f"><span>期數（月）</span><input type="text" inputmode="numeric" data-k="default_term_months" value="' + esc(money(p.default_term_months)) + '"></label>' +
            '</div><label class="check"><input type="checkbox" data-k="active"' + (p.active ? " checked" : "") + "> 用緊</label> " +
            '<button class="btn sm primary" data-act="save">存</button></details></div>';
        }).join("") + "</div>" +
        '<div class="card"><h2 style="margin-top:0">加產品</h2><div class="grid2"><label class="f"><span>名</span><input type="text" id="npName"></label>' +
        '<label class="f"><span>類別</span><input type="text" id="npCat"></label></div><button class="btn primary" id="npAdd">加</button></div>';
      $$("[data-prod]").forEach(function (row) {
        $('[data-act="save"]', row).addEventListener("click", function () {
          var v = function (k) { return $('[data-k="' + k + '"]', row); };
          api("/products/" + row.getAttribute("data-prod"), {
            name: v("name").value, category: v("category").value, active: v("active").checked,
            default_monthly_fee: v("default_monthly_fee").value, default_cost: v("default_cost").value,
            default_term_months: v("default_term_months").value,
          }).then(function () { toast("存咗"); meta(true); render(); }).catch(function (e) { toast(e.message, true); });
        });
      });
      $("#npAdd").addEventListener("click", function () {
        api("/products", { name: $("#npName").value, category: $("#npCat").value || null })
          .then(function () { toast("加咗"); meta(true); render(); }).catch(function (e) { toast(e.message, true); });
      });
    });
  }

  // ── 路由 ────────────────────────────────────────────────────────────────
  var ROUTES = [
    [/^#\/?$/, "today", viewToday],
    [/^#\/companies(\?.*)?$/, "companies", viewCompanies],
    [/^#\/c\/([^/?]+)/, "companies", viewCompany],
    [/^#\/new/, "companies", viewNew],
    [/^#\/calendar/, "calendar", viewCalendar],
    [/^#\/stats\/detail/, "stats", viewStatsDetail],
    [/^#\/stats/, "stats", viewStats],
    [/^#\/more/, "more", viewMore],
    [/^#\/import/, "more", viewImport],
    [/^#\/products/, "more", viewProducts],
  ];

  function render() {
    var h = location.hash || "#/";
    for (var i = 0; i < ROUTES.length; i++) {
      var m = ROUTES[i][0].exec(h);
      if (!m) continue;
      var tab = ROUTES[i][1];
      $$("#tabs a").forEach(function (a) { a.classList.toggle("on", a.getAttribute("data-tab") === tab); });
      var fn = ROUTES[i][2];
      return meta().then(function () { return fn(m[1] ? decodeURIComponent(m[1]) : undefined); }).catch(function (e) {
        view().innerHTML = '<div class="err">' + esc(e.message) + "</div>";
      });
    }
    view().innerHTML = '<p class="pad">冇呢版 —— <a href="#/">返今日</a></p>';
    return Promise.resolve();
  }

  window.addEventListener("hashchange", function () { render(); window.scrollTo(0, 0); });
  // ── 深淺色（頁頭粒掣：深色 → 淺色 → 跟系統 → 深色…）────────────────────────
  var THEMES = [
    ["dark", "深色", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'],
    ["light", "淺色", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'],
    ["auto", "跟系統", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>'],
  ];
  function currentTheme() {
    try { return localStorage.getItem("gc-theme") || "dark"; } catch (e) { return "dark"; }
  }
  function applyTheme(t) {
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    var b = $("#themeBtn");
    if (!b) return;
    var th = THEMES.filter(function (x) { return x[0] === t; })[0] || THEMES[0];
    b.innerHTML = th[2] + '<span>' + th[1] + "</span>";
    b.title = "而家：" + th[1] + "（撳一下轉）";
  }
  (function () {
    var b = $("#themeBtn");
    if (!b) return;
    applyTheme(currentTheme());
    b.addEventListener("click", function () {
      var i = THEMES.map(function (x) { return x[0]; }).indexOf(currentTheme());
      var next = THEMES[(i + 1) % THEMES.length][0];
      try { localStorage.setItem("gc-theme", next); } catch (e) {}
      applyTheme(next);
      toast("而家：" + THEMES[(i + 1) % THEMES.length][1]);
    });
  })();

  window.GC = { render: render, ready: render(), fmt: fmt, fmtDay: fmtDay };
})();
