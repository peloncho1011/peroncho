export type Priority = "高" | "中" | "低";
export type RecurringFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type BusinessDayAdjustment = "as_is" | "previous" | "next";

export type RecurringSubtaskTemplate = {
  id: string;
  title: string;
};

export type RecurringTemplate = {
  id: string;
  title: string;
  frequency: RecurringFrequency;
  enabled: boolean;
  category: string;
  priority: Priority;
  minutes: number;
  note?: string;
  createdAt: string;
  createDayOfMonth: number;
  dueDayOfMonth: number;
  createDayOfWeek: number;
  createMonth: number;
  createDayOfYearMonth: number;
  dueOffsetDays: number;
  notificationDays: number[];
  businessDayAdjustment: BusinessDayAdjustment;
  subtasks: RecurringSubtaskTemplate[];
};

export type RecurringOccurrence = {
  templateId: string;
  periodKey: string;
  createDate: string;
  dueDate: string;
};

const DAY_MS = 86_400_000;

export function createDefaultRecurringTemplates(today = new Date()): RecurringTemplate[] {
  const createdAt = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  return [
    makeMonthlyTemplate("monthly-results", "実績を計算する", 5, "高", createdAt),
    makeMonthlyTemplate("monthly-paid-leave", "有給休暇を確認する", 20, "中", createdAt),
  ];
}

function makeMonthlyTemplate(id: string, title: string, dueDay: number, priority: Priority, createdAt: string): RecurringTemplate {
  return {
    id,
    title,
    frequency: "monthly",
    enabled: true,
    category: "仕事",
    priority,
    minutes: 30,
    createdAt,
    createDayOfMonth: 1,
    dueDayOfMonth: dueDay,
    createDayOfWeek: 1,
    createMonth: 1,
    createDayOfYearMonth: 1,
    dueOffsetDays: 0,
    notificationDays: [3, 1, 0],
    businessDayAdjustment: "as_is",
    subtasks: [],
  };
}

export function getDueOccurrences(template: RecurringTemplate, now: Date, generatedKeys: ReadonlySet<string>): RecurringOccurrence[] {
  if (!template.enabled) return [];
  const today = startOfDay(now);
  const start = startOfDay(new Date(`${template.createdAt}T00:00:00`));
  if (Number.isNaN(start.getTime()) || start > today) return [];

  const candidates = template.frequency === "daily"
    ? dailyCandidates(start, today)
    : template.frequency === "weekly"
      ? weeklyCandidates(start, today, template.createDayOfWeek)
      : template.frequency === "yearly"
        ? yearlyCandidates(start, today, template.createMonth, template.createDayOfYearMonth)
        : monthlyCandidates(start, today, template.createDayOfMonth);

  return candidates.flatMap(({ date, periodKey }) => {
    const ledgerKey = recurringLedgerKey(template.id, periodKey);
    if (generatedKeys.has(ledgerKey)) return [];
    const rawDue = template.frequency === "monthly"
      ? monthlyDueDate(date, template.createDayOfMonth, template.dueDayOfMonth)
      : addDays(date, template.dueOffsetDays);
    const adjustedDue = adjustBusinessDay(rawDue, template.businessDayAdjustment);
    return [{
      templateId: template.id,
      periodKey,
      createDate: toDateText(date),
      dueDate: toDateText(adjustedDue),
    }];
  });
}

export function getNextOccurrence(template: RecurringTemplate, from = new Date()): RecurringOccurrence {
  const today = startOfDay(from);
  let createDate: Date;
  let periodKey: string;

  if (template.frequency === "daily") {
    createDate = today;
    periodKey = toDateText(createDate);
  } else if (template.frequency === "weekly") {
    const distance = (template.createDayOfWeek - today.getDay() + 7) % 7;
    createDate = addDays(today, distance);
    periodKey = weekKey(createDate);
  } else if (template.frequency === "yearly") {
    createDate = safeDate(today.getFullYear(), template.createMonth - 1, template.createDayOfYearMonth);
    if (createDate < today) createDate = safeDate(today.getFullYear() + 1, template.createMonth - 1, template.createDayOfYearMonth);
    periodKey = String(createDate.getFullYear());
  } else {
    createDate = safeDate(today.getFullYear(), today.getMonth(), template.createDayOfMonth);
    if (createDate < today) createDate = safeDate(today.getFullYear(), today.getMonth() + 1, template.createDayOfMonth);
    periodKey = monthKey(createDate);
  }

  const rawDue = template.frequency === "monthly"
    ? monthlyDueDate(createDate, template.createDayOfMonth, template.dueDayOfMonth)
    : addDays(createDate, template.dueOffsetDays);
  return {
    templateId: template.id,
    periodKey,
    createDate: toDateText(createDate),
    dueDate: toDateText(adjustBusinessDay(rawDue, template.businessDayAdjustment)),
  };
}

export function occurrenceForMonthlyTest(template: RecurringTemplate, from = new Date()): RecurringOccurrence {
  const nextMonth = safeDate(from.getFullYear(), from.getMonth() + 1, template.createDayOfMonth);
  const due = adjustBusinessDay(
    monthlyDueDate(nextMonth, template.createDayOfMonth, template.dueDayOfMonth),
    template.businessDayAdjustment,
  );
  return {
    templateId: template.id,
    periodKey: monthKey(nextMonth),
    createDate: toDateText(nextMonth),
    dueDate: toDateText(due),
  };
}

export function recurringLedgerKey(templateId: string, periodKey: string) {
  return `${templateId}:${periodKey}`;
}

export function frequencyLabel(frequency: RecurringFrequency) {
  return { daily: "毎日", weekly: "毎週", monthly: "毎月", yearly: "毎年" }[frequency];
}

export function adjustmentLabel(adjustment: BusinessDayAdjustment) {
  return { as_is: "そのままの日付", previous: "前の平日", next: "次の平日" }[adjustment];
}

export function isBusinessDay(date: Date) {
  return date.getDay() !== 0 && date.getDay() !== 6 && !isJapaneseHoliday(date);
}

export function isJapaneseHoliday(date: Date) {
  const target = startOfDay(date);
  const holidays = japaneseHolidaySet(target.getFullYear());
  return holidays.has(toDateText(target));
}

function adjustBusinessDay(date: Date, adjustment: BusinessDayAdjustment) {
  if (adjustment === "as_is" || isBusinessDay(date)) return date;
  const direction = adjustment === "previous" ? -1 : 1;
  let adjusted = date;
  do adjusted = addDays(adjusted, direction); while (!isBusinessDay(adjusted));
  return adjusted;
}

function dailyCandidates(start: Date, today: Date) {
  const result: Array<{ date: Date; periodKey: string }> = [];
  const lowerBound = new Date(Math.max(start.getTime(), addDays(today, -366).getTime()));
  for (let date = lowerBound; date <= today; date = addDays(date, 1)) result.push({ date, periodKey: toDateText(date) });
  return result;
}

function weeklyCandidates(start: Date, today: Date, weekDay: number) {
  const result: Array<{ date: Date; periodKey: string }> = [];
  let date = addDays(start, (weekDay - start.getDay() + 7) % 7);
  const lowerBound = addDays(today, -371);
  while (date < lowerBound) date = addDays(date, 7);
  for (; date <= today; date = addDays(date, 7)) result.push({ date, periodKey: weekKey(date) });
  return result;
}

function monthlyCandidates(start: Date, today: Date, day: number) {
  const result: Array<{ date: Date; periodKey: string }> = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const oldest = new Date(today.getFullYear() - 2, today.getMonth(), 1);
  if (cursor < oldest) cursor = oldest;
  const last = new Date(today.getFullYear(), today.getMonth(), 1);
  for (; cursor <= last; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
    const date = safeDate(cursor.getFullYear(), cursor.getMonth(), day);
    if (date >= start && date <= today) result.push({ date, periodKey: monthKey(date) });
  }
  return result;
}

function yearlyCandidates(start: Date, today: Date, month: number, day: number) {
  const result: Array<{ date: Date; periodKey: string }> = [];
  for (let year = Math.max(start.getFullYear(), today.getFullYear() - 5); year <= today.getFullYear(); year += 1) {
    const date = safeDate(year, month - 1, day);
    if (date >= start && date <= today) result.push({ date, periodKey: String(year) });
  }
  return result;
}

function japaneseHolidaySet(year: number) {
  const holidays = new Set<string>();
  const add = (month: number, day: number) => holidays.add(toDateText(new Date(year, month - 1, day)));
  add(1, 1);
  add(2, 11);
  add(2, 23);
  add(4, 29);
  add(5, 3);
  add(5, 4);
  add(5, 5);
  add(8, 11);
  add(11, 3);
  add(11, 23);
  add(1, nthWeekday(year, 0, 1, 2));
  add(7, nthWeekday(year, 6, 1, 3));
  add(9, nthWeekday(year, 8, 1, 3));
  add(10, nthWeekday(year, 9, 1, 2));
  add(3, vernalEquinoxDay(year));
  add(9, autumnalEquinoxDay(year));

  // 祝日に挟まれた平日は「国民の休日」です。
  for (let date = new Date(year, 0, 2); date.getFullYear() === year; date = addDays(date, 1)) {
    if (!holidays.has(toDateText(date)) && holidays.has(toDateText(addDays(date, -1))) && holidays.has(toDateText(addDays(date, 1)))) holidays.add(toDateText(date));
  }
  // 日曜の祝日は、次に来る祝日ではない日へ振り替えます。
  const original = [...holidays].sort();
  for (const dateText of original) {
    const date = new Date(`${dateText}T00:00:00`);
    if (date.getDay() !== 0) continue;
    let substitute = addDays(date, 1);
    while (holidays.has(toDateText(substitute))) substitute = addDays(substitute, 1);
    holidays.add(toDateText(substitute));
  }
  return holidays;
}

function nthWeekday(year: number, monthIndex: number, weekday: number, nth: number) {
  const first = new Date(year, monthIndex, 1);
  return 1 + ((weekday - first.getDay() + 7) % 7) + (nth - 1) * 7;
}

function vernalEquinoxDay(year: number) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnalEquinoxDay(year: number) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function safeDate(year: number, monthIndex: number, day: number) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(Math.max(1, day), lastDay));
}

function monthlyDueDate(createDate: Date, createDay: number, dueDay: number) {
  const dueMonthOffset = dueDay < createDay ? 1 : 0;
  return safeDate(createDate.getFullYear(), createDate.getMonth() + dueMonthOffset, dueDay);
}

function weekKey(date: Date) {
  const thursday = addDays(date, 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round((thursday.getTime() - addDays(firstThursday, 3 - ((firstThursday.getDay() + 6) % 7)).getTime()) / (7 * DAY_MS));
  return `${thursday.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return startOfDay(result);
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function toDateText(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
