/**
 * 記電話：一次撥打 ＝ 一行 calls。
 *
 * 一個 transaction 做晒（做一半 ＝ 回撥提醒翻生，Equal CRM 中過）：
 *   1. 鎖住間公司（同一間同時記兩次唔會撞亂「第幾次」）
 *   2. 寫 call
 *   3. 自動收舊嘅回撥／跟進／寄電郵（❗唔收「到期提醒」—— 嗰個係合約到期，唔係因為打咗電話就做完）
 *   4. 按撳嗰粒掣開新待辦
 *   5. 改公司狀態
 *   6. audit_log
 */

import { one, toJson, type Sql } from "../db/client.js";
import { blankToNull } from "../lib/text.js";
import { assertDay } from "../lib/time.js";
import {
  isOutcome, nextStatus, RULES, taskFor, validateCall,
  type CompanyStatus, type Outcome, type TaskKind,
} from "./outcomes.js";

/** 再打一次電話會自動收嘅待辦種類。 */
export const AUTO_CLOSE_KINDS: readonly TaskKind[] = ["回撥", "跟進", "寄電郵"];

export interface LogCallInput {
  companyId: string;
  outcome: string;
  calledAt?: Date | null;
  callbackAt?: Date | null;
  content?: string | null;
  reachedR?: boolean;
  gotD?: boolean;
  dContractEnd?: string | null;
  dPrice?: string | null;
  dPlan?: string | null;
  dProvider?: string | null;
  otherFollower?: string | null;
  attemptNo?: number | null;
  phoneDialed?: string | null;
  contactId?: string | null;
  taskNote?: string | null;
}

export interface CallRow {
  id: string;
  company_id: string;
  called_at: Date;
  attempt_no: number;
  outcome: Outcome;
  callback_at: Date | null;
  content: string | null;
  reached_r: boolean;
  got_d: boolean;
  d_contract_end: string | null;
  d_price: string | null;
  d_plan: string | null;
  d_provider: string | null;
  other_follower: string | null;
  phone_dialed: string | null;
  contact_id: string | null;
  created_at: Date;
}

export interface LogCallResult {
  call: CallRow;
  /** 呢次電話自動收咗幾多個舊待辦。 */
  closedTasks: number;
  /** 呢次開咗嘅新待辦（冇就 null）。 */
  task: { id: string; kind: TaskKind; due_at: Date | null } | null;
  statusBefore: CompanyStatus;
  statusAfter: CompanyStatus;
  connected: boolean;
}

export async function logCall(sql: Sql, input: LogCallInput, actor = "web"): Promise<LogCallResult> {
  const callbackAt = input.callbackAt ?? null;
  const otherFollower = blankToNull(input.otherFollower);
  validateCall({
    outcome: input.outcome, callbackAt, otherFollower,
    attemptNo: input.attemptNo ?? null,
  });
  const outcome = input.outcome as Outcome;
  const dContractEnd = blankToNull(input.dContractEnd);
  if (dContractEnd) assertDay(dContractEnd);
  const dPrice = blankToNull(input.dPrice);
  const dPlan = blankToNull(input.dPlan);
  const dProvider = blankToNull(input.dProvider);
  // 填咗任何一樣 D 資料就自動算 D（UI 都會自動剔，呢度再保一次）
  const gotD = Boolean(input.gotD) || Boolean(dContractEnd || dPrice || dPlan || dProvider);

  return sql.begin(async (tx) => {
    const [co] = await tx<{ id: string; status: CompanyStatus }[]>`
      select id, status from public.companies where id = ${input.companyId} for update`;
    if (!co) throw new Error("搵唔到呢間公司（可能啱啱被刪咗）");

    let attemptNo = input.attemptNo ?? null;
    if (attemptNo === null) {
      const { n } = one(await tx<{ n: number }[]>`
        select count(*)::int as n from public.calls where company_id = ${co.id}`);
      attemptNo = n + 1;
    }

    const call = one(await tx<CallRow[]>`
      insert into public.calls (
        company_id, contact_id, called_at, attempt_no, outcome, callback_at, content,
        reached_r, got_d, d_contract_end, d_price, d_plan, d_provider,
        other_follower, phone_dialed
      ) values (
        ${co.id}, ${blankToNull(input.contactId)}, ${input.calledAt ?? new Date()}, ${attemptNo},
        ${outcome}, ${callbackAt}, ${blankToNull(input.content)},
        ${Boolean(input.reachedR)}, ${gotD}, ${dContractEnd}, ${dPrice}, ${dPlan}, ${dProvider},
        ${otherFollower}, ${blankToNull(input.phoneDialed)}
      ) returning *`, "啱啱寫入嘅電話記錄");

    const closed = await tx<{ id: string }[]>`
      update public.tasks
         set status = '完成', closed_at = now(), closed_by_call_id = ${call.id}
       where company_id = ${co.id} and status = '待辦'
         and kind in ${tx(AUTO_CLOSE_KINDS as string[])}
       returning id`;

    let task: LogCallResult["task"] = null;
    const kind = taskFor(outcome, callbackAt !== null);
    if (kind) {
      task = one(await tx<{ id: string; kind: TaskKind; due_at: Date | null }[]>`
        insert into public.tasks (company_id, kind, due_at, note, source_call_id)
        values (${co.id}, ${kind}, ${callbackAt}, ${blankToNull(input.taskNote) ?? blankToNull(input.content)}, ${call.id})
        returning id, kind, due_at`, "啱啱開嘅待辦");
    }

    const statusAfter = nextStatus(co.status, outcome);
    if (outcome === "其他人跟進") {
      await tx`update public.companies set status = ${statusAfter}, followed_by = ${otherFollower}
               where id = ${co.id}`;
    } else if (statusAfter !== co.status) {
      await tx`update public.companies set status = ${statusAfter} where id = ${co.id}`;
    }

    await tx`
      insert into public.audit_log (actor, action, table_name, record_id, before, after)
      values (${actor}, 'log_call', 'calls', ${call.id},
              ${tx.json(toJson({ status: co.status }))},
              ${tx.json(toJson({ call, status: statusAfter, closedTasks: closed.length, task: task?.id ?? null }))})`;

    return {
      call, closedTasks: closed.length, task,
      statusBefore: co.status, statusAfter, connected: RULES[outcome].connected,
    };
  });
}

export interface UpdateCallInput {
  content?: string | null;
  reachedR?: boolean;
  gotD?: boolean;
  dContractEnd?: string | null;
  dPrice?: string | null;
  dPlan?: string | null;
  dProvider?: string | null;
  attemptNo?: number;
}

export async function updateCall(sql: Sql, id: string, patch: UpdateCallInput, actor = "web"): Promise<CallRow> {
  if ("outcome" in (patch as Record<string, unknown>)) {
    throw new Error("結果改唔到 —— 揀錯就刪咗呢次記錄再記過（佢收咗嘅舊提醒會返嚟）");
  }
  const set: Record<string, unknown> = {};
  if (patch.content !== undefined) set.content = blankToNull(patch.content);
  if (patch.reachedR !== undefined) set.reached_r = Boolean(patch.reachedR);
  if (patch.dContractEnd !== undefined) {
    const d = blankToNull(patch.dContractEnd);
    if (d) assertDay(d);
    set.d_contract_end = d;
  }
  if (patch.dPrice !== undefined) set.d_price = blankToNull(patch.dPrice);
  if (patch.dPlan !== undefined) set.d_plan = blankToNull(patch.dPlan);
  if (patch.dProvider !== undefined) set.d_provider = blankToNull(patch.dProvider);
  if (patch.attemptNo !== undefined) {
    if (!Number.isInteger(patch.attemptNo) || patch.attemptNo < 1) throw new Error("第幾次致電要係 1 或以上嘅整數");
    set.attempt_no = patch.attemptNo;
  }
  if (patch.gotD !== undefined) set.got_d = Boolean(patch.gotD);
  // 填咗 D 資料就算 D（同 logCall 一樣），除非佢明明白白剔走咗
  else if (["d_contract_end", "d_price", "d_plan", "d_provider"].some((k) => set[k])) set.got_d = true;
  return sql.begin(async (tx) => {
    const before = one(await tx<CallRow[]>`select * from public.calls where id = ${id} for update`, "呢次電話記錄");
    if (!Object.keys(set).length) return before;
    const after = one(await tx<CallRow[]>`update public.calls set ${tx(set)} where id = ${id} returning *`, "改完嘅記錄");
    await tx`insert into public.audit_log (actor, action, table_name, record_id, before, after)
             values (${actor}, 'update_call', 'calls', ${id}, ${tx.json(toJson(before))}, ${tx.json(toJson(set))})`;
    return after;
  });
}

/**
 * 刪一次電話記錄（揀錯結果用）：
 *   · 佢開嘅待辦（仲未做）一齊刪
 *   · 佢自動收咗嘅舊待辦返嚟（變返待辦）—— 唔係就變咗「提醒冇咗」
 */
export async function deleteCall(sql: Sql, id: string, actor = "web"): Promise<{ reopened: number; removedTasks: number }> {
  return sql.begin(async (tx) => {
    const before = one(await tx<CallRow[]>`select * from public.calls where id = ${id} for update`, "呢次電話記錄");
    const removed = await tx`delete from public.tasks where source_call_id = ${id} and status = '待辦' returning id`;
    const reopened = await tx`
      update public.tasks set status = '待辦', closed_at = null, closed_by_call_id = null
       where closed_by_call_id = ${id} and status = '完成' returning id`;
    await tx`delete from public.calls where id = ${id}`;
    await tx`insert into public.audit_log (actor, action, table_name, record_id, before, after)
             values (${actor}, 'delete_call', 'calls', ${id}, ${tx.json(toJson(before))},
                     ${tx.json(toJson({ reopened: reopened.length, removedTasks: removed.length }))})`;
    return { reopened: reopened.length, removedTasks: removed.length };
  });
}

export { isOutcome };
