import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultRecurringTemplates,
  getDueOccurrences,
  getNextOccurrence,
  isJapaneseHoliday,
  recurringLedgerKey,
  type RecurringTemplate,
} from "./recurring.ts";

function monthly(overrides: Partial<RecurringTemplate> = {}): RecurringTemplate {
  return {
    ...createDefaultRecurringTemplates(new Date("2026-07-01T00:00:00"))[0],
    id: "test-monthly",
    createdAt: "2026-07-01",
    ...overrides,
  };
}

test("1日に開かなくても3日に今月分を1件生成する", () => {
  const occurrences = getDueOccurrences(monthly(), new Date("2026-07-03T12:00:00"), new Set());
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].periodKey, "2026-07");
  assert.equal(occurrences[0].createDate, "2026-07-01");
  assert.equal(occurrences[0].dueDate, "2026-07-05");
});

test("定例IDと対象年月が記録済みなら重複生成しない", () => {
  const template = monthly();
  const ledger = new Set([recurringLedgerKey(template.id, "2026-07")]);
  assert.deepEqual(getDueOccurrences(template, new Date("2026-07-22T12:00:00"), ledger), []);
});

test("祝日の期限を次の平日に変更できる", () => {
  const template = monthly({ dueDayOfMonth: 20, businessDayAdjustment: "next" });
  assert.equal(isJapaneseHoliday(new Date("2026-07-20T00:00:00")), true);
  const occurrence = getDueOccurrences(template, new Date("2026-07-22T12:00:00"), new Set())[0];
  assert.equal(occurrence.dueDate, "2026-07-21");
});

test("祝日の期限を前の平日に変更できる", () => {
  const template = monthly({ dueDayOfMonth: 20, businessDayAdjustment: "previous" });
  const occurrence = getDueOccurrences(template, new Date("2026-07-22T12:00:00"), new Set())[0];
  assert.equal(occurrence.dueDate, "2026-07-17");
});

test("期限日が作成日より前なら翌月の期限にする", () => {
  const template = monthly({ createDayOfMonth: 25, dueDayOfMonth: 5 });
  const next = getNextOccurrence(template, new Date("2026-07-01T12:00:00"));
  assert.equal(next.createDate, "2026-07-25");
  assert.equal(next.dueDate, "2026-08-05");
});

test("31日指定は短い月の末日に収める", () => {
  const template = monthly({ createDayOfMonth: 31, dueDayOfMonth: 31 });
  const next = getNextOccurrence(template, new Date("2027-02-01T12:00:00"));
  assert.equal(next.createDate, "2027-02-28");
  assert.equal(next.dueDate, "2027-02-28");
});
