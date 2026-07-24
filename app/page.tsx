"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createBrowserSupabase } from "../lib/supabase";
import {
  adjustmentLabel,
  createDefaultRecurringTemplates,
  frequencyLabel,
  getDueOccurrences,
  getNextOccurrence,
  occurrenceForMonthlyTest,
  recurringLedgerKey,
  type BusinessDayAdjustment,
  type RecurringFrequency,
  type RecurringOccurrence,
  type RecurringTemplate,
} from "../lib/recurring";

type DueTone = "urgent" | "soon" | "safe" | "none";
type Subtask = {
  id: number;
  title: string;
  completed: boolean;
  due?: string;
  dueTone?: DueTone;
  dueProgress?: number;
  dueDate?: string;
};
type Task = {
  id: number;
  title: string;
  due: string;
  dueTone: DueTone;
  dueProgress: number | null;
  dueDate?: string;
  dueTotalDays?: number;
  priority: "高" | "中" | "低";
  category: string;
  minutes: number;
  reason?: string;
  subtasks: Subtask[];
  completedAt?: string;
  note?: string;
  recurringSource?: {
    templateId: string;
    periodKey: string;
    notificationDays: number[];
  };
};

type AiAction = "create_task" | "add_subtask" | "update_due_date" | "update_priority" | "complete_task" | "ask_clarification";
type AiDecision = {
  action: AiAction;
  title: string;
  targetTaskId: number | null;
  targetTaskTitle: string | null;
  dueDate: string | null;
  priority: Task["priority"] | null;
  category: string | null;
  minutes: number | null;
  reason: string;
  confirmationMessage: string;
  clarificationQuestion: string | null;
  confidence: number;
};

const STORAGE_KEY = "peroncho-os-data-v3";
const initialTasks: Task[] = [];
const oldHistory: Task[] = [];

type Sheet = "none" | "detail" | "manual" | "ai" | "confirm" | "history" | "settings" | "warning" | "delete" | "recurringList" | "recurringEdit" | "recurringDelete" | "account" | "notifications";

export default function Home() {
  const [tasks, setTasks] = useState(initialTasks);
  const [history, setHistory] = useState(oldHistory);
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTemplate[]>([]);
  const [generatedRecurringKeys, setGeneratedRecurringKeys] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Sheet>("none");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [speech, setSpeech] = useState("");
  const [sort, setSort] = useState("おすすめ順");
  const [filter, setFilter] = useState("すべて");
  const [storageReady, setStorageReady] = useState(false);
  const [addAsSubtask, setAddAsSubtask] = useState(false);
  const [aiDecision, setAiDecision] = useState<AiDecision | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [selectedRecurringId, setSelectedRecurringId] = useState<string | null>(null);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatFrequency, setRepeatFrequency] = useState<RecurringFrequency>("monthly");
  const [recurringSubtasks, setRecurringSubtasks] = useState<string[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [cloudStatus, setCloudStatus] = useState<"local" | "syncing" | "synced" | "error">("local");
  const [notificationHour, setNotificationHour] = useState(8);
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const cloudLoadedFor = useRef<string | null>(null);
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const now = new Date();
  const greeting = now.getHours() < 11 ? "おはようございます" : now.getHours() < 18 ? "こんにちは" : "こんばんは";
  const todayLabel = new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "long" }).format(now);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as { tasks?: Task[]; history?: Task[]; recurringTemplates?: RecurringTemplate[]; generatedRecurringKeys?: string[] };
          const savedTasks = Array.isArray(parsed.tasks) ? parsed.tasks.map(refreshDeadline) : [];
          const templates = isRecurringTemplateArray(parsed.recurringTemplates) ? parsed.recurringTemplates : createDefaultRecurringTemplates(new Date());
          const ledger = Array.isArray(parsed.generatedRecurringKeys) ? parsed.generatedRecurringKeys.filter((key): key is string => typeof key === "string") : [];
          const generated = generateRecurringTasks(templates, savedTasks, ledger, new Date());
          setTasks(generated.tasks);
          setRecurringTemplates(templates);
          setGeneratedRecurringKeys(generated.ledger);
          if (Array.isArray(parsed.history)) setHistory(parsed.history);
        } else {
          const templates = createDefaultRecurringTemplates(new Date());
          const generated = generateRecurringTasks(templates, [], [], new Date());
          setRecurringTemplates(templates);
          setTasks(generated.tasks);
          setGeneratedRecurringKeys(generated.ledger);
        }
      } catch {
        // 壊れた保存データがあっても、初期データで安全に起動します。
      } finally {
        setStorageReady(true);
      }
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, history, recurringTemplates, generatedRecurringKeys }));
  }, [tasks, history, recurringTemplates, generatedRecurringKeys, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    if (window.sessionStorage.getItem("peroncho-recurring-reminder") === todayKey) return;
    const reminderCount = tasks.filter((task) => task.recurringSource && task.dueDate && task.recurringSource.notificationDays.includes(daysUntil(task.dueDate))).length;
    if (!reminderCount) return;
    window.sessionStorage.setItem("peroncho-recurring-reminder", todayKey);
    setToast(`期限が近い定例タスクが${reminderCount}件あります`);
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [storageReady, tasks]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!storageReady || !session || !supabase || cloudLoadedFor.current === session.user.id || cloudLoadedFor.current === `loading:${session.user.id}`) return;
    cloudLoadedFor.current = `loading:${session.user.id}`;
    setCloudStatus("syncing");
    supabase.from("user_app_state").select("payload").eq("user_id", session.user.id).maybeSingle().then(({ data, error }) => {
      if (error) {
        cloudLoadedFor.current = null;
        setCloudStatus("error");
        return;
      }
      const payload = data?.payload as { tasks?: Task[]; history?: Task[]; recurringTemplates?: RecurringTemplate[]; generatedRecurringKeys?: string[]; notificationHour?: number } | undefined;
      if (payload && isTaskArray(payload.tasks) && isTaskArray(payload.history)) {
        setTasks(payload.tasks.map(refreshDeadline));
        setHistory(payload.history);
        if (isRecurringTemplateArray(payload.recurringTemplates)) setRecurringTemplates(payload.recurringTemplates);
        if (Array.isArray(payload.generatedRecurringKeys)) setGeneratedRecurringKeys(payload.generatedRecurringKeys);
        if (typeof payload.notificationHour === "number") setNotificationHour(payload.notificationHour);
      }
      cloudLoadedFor.current = session.user.id;
      setCloudStatus("synced");
    });
  }, [storageReady, session, supabase]);

  useEffect(() => {
    if (!storageReady || !session || !supabase || cloudLoadedFor.current !== session.user.id) return;
    setCloudStatus("syncing");
    const timer = window.setTimeout(async () => {
      const { error } = await supabase.from("user_app_state").upsert({
        user_id: session.user.id,
        payload: { tasks, history, recurringTemplates, generatedRecurringKeys, notificationHour },
        updated_at: new Date().toISOString(),
      });
      setCloudStatus(error ? "error" : "synced");
    }, 700);
    return () => window.clearTimeout(timer);
  }, [tasks, history, recurringTemplates, generatedRecurringKeys, notificationHour, storageReady, session, supabase]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js");
    if ("Notification" in window) setNotificationEnabled(Notification.permission === "granted");
  }, []);

  const selected = tasks.find((task) => task.id === selectedId) ?? history.find((task) => task.id === selectedId);
  const topThree = useMemo(() => [...tasks]
    .sort((a, b) => taskScore(b) - taskScore(a))
    .slice(0, 3)
    .map((task) => ({ ...task, reason: topReason(task) })), [tasks]);
  const others = useMemo(() => {
    const topIds = new Set(topThree.map((task) => task.id));
    let list = tasks.filter((task) => !topIds.has(task.id));
    if (filter !== "すべて") list = list.filter((task) => task.category === filter);
    if (sort === "優先度順") {
      const rank = { 高: 0, 中: 1, 低: 2 };
      list = [...list].sort((a, b) => rank[a.priority] - rank[b.priority]);
    }
    if (sort === "期限が近い順") list = [...list].sort((a, b) => (a.dueProgress ?? 999) - (b.dueProgress ?? 999));
    if (sort === "新しい順") list = [...list].sort((a, b) => b.id - a.id);
    return list;
  }, [tasks, topThree, filter, sort]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  async function sendLoginLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !authEmail.trim()) return;
    const { error } = await supabase.auth.signInWithOtp({
      email: authEmail.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setAuthMessage(error ? error.message : "ログイン用メールを送りました。メール内のリンクを押してください。");
  }

  async function signOut() {
    await supabase?.auth.signOut();
    cloudLoadedFor.current = null;
    setCloudStatus("local");
    setSheet("settings");
    notify("ログアウトしました");
  }

  async function enablePushNotifications() {
    if (!session) {
      setSheet("account");
      setAuthMessage("通知を使うには、先にログインしてください。");
      return;
    }
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator)) throw new Error("iPhoneではホーム画面に追加したアプリから設定してください");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("iPhoneの設定で通知を許可してください");
      const registration = await navigator.serviceWorker.ready;
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw new Error("VAPID公開鍵が未設定です");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ subscription: subscription.toJSON(), notificationHour }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "通知登録に失敗しました");
      setNotificationEnabled(true);
      notify("お知らせを有効にしました");
    } catch (error) {
      notify(error instanceof Error ? error.message : "通知設定に失敗しました");
    }
  }

  async function sendTestNotification() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) throw new Error("先にお知らせを有効にしてください");
      const response = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "通知テストに失敗しました");
      notify("テスト通知を送信しました");
    } catch (error) {
      notify(error instanceof Error ? error.message : "通知テストに失敗しました");
    }
  }

  function openTask(id: number) {
    setSelectedId(id);
    setSheet("detail");
  }

  function toggleSubtask(taskId: number, subtaskId: number) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? { ...task, subtasks: task.subtasks.map((sub) => (sub.id === subtaskId ? { ...sub, completed: !sub.completed } : sub)) }
          : task,
      ),
    );
  }

  function requestComplete(id: number) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    setSelectedId(id);
    if (task.subtasks.some((sub) => !sub.completed)) setSheet("warning");
    else completeTask(id);
  }

  function completeTask(id: number) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    setTasks((current) => current.filter((item) => item.id !== id));
    setHistory((current) => [{ ...task, completedAt: formatCompletedAt(new Date()) }, ...current]);
    setSheet("none");
    notify("完了履歴へ移動しました");
  }

  function restoreTask(id: number) {
    const task = history.find((item) => item.id === id);
    if (!task) return;
    const restored = { ...task };
    delete restored.completedAt;
    setHistory((current) => current.filter((item) => item.id !== id));
    setTasks((current) => [...current, restored]);
    setSheet("history");
    notify("未完了のタスクへ戻しました");
  }

  function deleteTask(id: number) {
    setTasks((current) => current.filter((task) => task.id !== id));
    setHistory((current) => current.filter((task) => task.id !== id));
    setSelectedId(null);
    setSheet("none");
    notify("タスクを削除しました");
  }

  function exportBackup() {
    const backup = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), tasks, history, recurringTemplates, generatedRecurringKeys }, null, 2);
    const url = URL.createObjectURL(new Blob([backup], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `peroncho-os-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    notify("バックアップを書き出しました");
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("backup too large");
      const parsed = JSON.parse(await file.text()) as { tasks?: Task[]; history?: Task[]; recurringTemplates?: RecurringTemplate[]; generatedRecurringKeys?: string[] };
      if (!isTaskArray(parsed.tasks) || !isTaskArray(parsed.history)) throw new Error("invalid backup");
      if (!window.confirm("現在のタスクを、選んだバックアップの内容に置き換えますか？")) return;
      setTasks(parsed.tasks.map(refreshDeadline));
      setHistory(parsed.history);
      if (isRecurringTemplateArray(parsed.recurringTemplates)) setRecurringTemplates(parsed.recurringTemplates);
      if (Array.isArray(parsed.generatedRecurringKeys)) setGeneratedRecurringKeys(parsed.generatedRecurringKeys.filter((key): key is string => typeof key === "string"));
      setSheet("none");
      notify("バックアップを読み込みました");
    } catch {
      notify("このファイルは読み込めませんでした");
    }
  }

  function addManualTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    if (!title) return;
    const category = String(form.get("category") ?? "その他");
    const priority = String(form.get("priority") ?? "中") as Task["priority"];
    const dueDate = String(form.get("dueDate") ?? "");
    const minutes = Math.max(1, Number(form.get("minutes")) || 15);
    const note = String(form.get("note") ?? "").trim();
    const deadline = createDeadline(dueDate);
    const editingTask = tasks.find((task) => task.id === selectedId);

    if (!addAsSubtask && repeatEnabled) {
      if (editingTask) convertTaskToRecurring(form, editingTask, { title, category, priority, minutes, note, deadline });
      else saveNewRecurringFromTaskForm(form);
      return;
    }

    if (addAsSubtask && editingTask) {
      setTasks((current) => current.map((task) => task.id === editingTask.id ? {
        ...task,
        subtasks: [...task.subtasks, {
          id: Date.now(),
          title,
          completed: false,
          ...(dueDate ? { dueDate, due: deadline.due, dueTone: deadline.dueTone, dueProgress: deadline.dueProgress ?? undefined } : {}),
        }],
      } : task));
      notify("サブタスクを追加しました");
    } else if (editingTask) {
      setTasks((current) => current.map((task) => task.id === editingTask.id ? {
        ...task,
        title,
        priority,
        category,
        minutes,
        note,
        ...deadline,
      } : task));
      notify("タスクを更新しました");
    } else {
      setTasks((current) => [...current, {
        id: Date.now(),
        title,
        priority,
        category,
        minutes,
        note,
        subtasks: [],
        ...deadline,
      }]);
      notify("新しいタスクを追加しました");
    }
    setSheet("none");
    setSelectedId(null);
    setAddAsSubtask(false);
  }

  function saveNewRecurringFromTaskForm(form: FormData) {
    const template = recurringTemplateFromForm(form, null, recurringSubtasks);
    const nextTemplates = [...recurringTemplates, template];
    const generated = generateRecurringTasks(nextTemplates, tasks, generatedRecurringKeys, new Date());
    setRecurringTemplates(nextTemplates);
    setTasks(generated.tasks);
    setGeneratedRecurringKeys(generated.ledger);
    setSheet("none");
    setRepeatEnabled(false);
    setRecurringSubtasks([]);
    notify(generated.createdCount ? "定例タスクを登録し、今月分を作成しました" : "定例タスクを登録しました");
  }

  function convertTaskToRecurring(form: FormData, editingTask: Task, values: { title: string; category: string; priority: Task["priority"]; minutes: number; note: string; deadline: ReturnType<typeof createDeadline> }) {
    const template = recurringTemplateFromForm(form, null, recurringSubtasks);
    const ledger = new Set(generatedRecurringKeys);
    const currentOccurrence = getDueOccurrences(template, new Date(), ledger).at(-1);
    if (currentOccurrence) ledger.add(recurringLedgerKey(template.id, currentOccurrence.periodKey));
    setRecurringTemplates((current) => [...current, template]);
    setGeneratedRecurringKeys([...ledger]);
    setTasks((current) => current.map((task) => task.id === editingTask.id ? {
      ...task,
      ...values.deadline,
      title: values.title,
      category: values.category,
      priority: values.priority,
      minutes: values.minutes,
      note: values.note,
      ...(currentOccurrence ? { recurringSource: { templateId: template.id, periodKey: currentOccurrence.periodKey, notificationDays: template.notificationDays } } : {}),
    } : task));
    setSheet("none");
    setSelectedId(null);
    setRepeatEnabled(false);
    notify("このタスクを定例タスクとして登録しました");
  }

  function saveRecurringTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const existing = recurringTemplates.find((template) => template.id === selectedRecurringId) ?? null;
    const template = recurringTemplateFromForm(form, existing, recurringSubtasks);
    const nextTemplates = existing
      ? recurringTemplates.map((item) => item.id === existing.id ? template : item)
      : [...recurringTemplates, template];
    const generated = generateRecurringTasks(nextTemplates, tasks, generatedRecurringKeys, new Date());
    setRecurringTemplates(nextTemplates);
    setTasks(generated.tasks);
    setGeneratedRecurringKeys(generated.ledger);
    setSheet("recurringList");
    setSelectedRecurringId(null);
    setRecurringSubtasks([]);
    notify(existing ? "定例タスクを更新しました" : "定例タスクを登録しました");
  }

  function openRecurringEditor(id: string | null) {
    const template = recurringTemplates.find((item) => item.id === id);
    setSelectedRecurringId(id);
    setRepeatFrequency(template?.frequency ?? "monthly");
    setRecurringSubtasks(template?.subtasks.map((subtask) => subtask.title) ?? []);
    setSheet("recurringEdit");
  }

  function toggleRecurring(id: string) {
    setRecurringTemplates((current) => current.map((template) => template.id === id ? { ...template, enabled: !template.enabled } : template));
  }

  function deleteRecurringTemplate(id: string) {
    setRecurringTemplates((current) => current.filter((template) => template.id !== id));
    setSelectedRecurringId(null);
    setSheet("recurringList");
    notify("定例タスクを削除しました。作成済みの通常タスクは残ります");
  }

  function createNextMonthTest(template: RecurringTemplate) {
    if (template.frequency !== "monthly") return;
    const occurrence = occurrenceForMonthlyTest(template);
    const ledgerKey = recurringLedgerKey(template.id, occurrence.periodKey);
    if (generatedRecurringKeys.includes(ledgerKey)) {
      notify("翌月分はすでに作成済みです");
      return;
    }
    if (!window.confirm(`${occurrence.periodKey}分のタスクをテスト作成しますか？`)) return;
    setTasks((current) => [...current, taskFromOccurrence(template, occurrence)]);
    setGeneratedRecurringKeys((current) => [...current, ledgerKey]);
    notify("翌月分を通常タスクへテスト作成しました");
  }

  async function analyzeWithAi() {
    const trimmed = speech.trim();
    if (!trimmed || aiLoading) return;
    setAiLoading(true);
    setAiError("");
    setAiDecision(null);
    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speech: trimmed, tasks }),
      });
      const data = await response.json() as { decision?: AiDecision; error?: string };
      if (!response.ok || !data.decision) throw new Error(data.error || "AIが内容を整理できませんでした");
      setAiDecision(data.decision);
      setSheet("confirm");
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AIとの通信に失敗しました");
    } finally {
      setAiLoading(false);
    }
  }

  function applyAiDecision() {
    if (!aiDecision || aiDecision.action === "ask_clarification") return;
    const target = aiDecision.targetTaskId === null ? undefined : tasks.find((task) => task.id === aiDecision.targetTaskId);
    const deadline = createDeadline(aiDecision.dueDate ?? "");

    if (aiDecision.action === "create_task") {
      setTasks((current) => [...current, {
        id: Date.now(),
        title: aiDecision.title,
        priority: aiDecision.priority ?? "中",
        category: aiDecision.category ?? "その他",
        minutes: Math.max(1, aiDecision.minutes ?? 15),
        subtasks: [],
        ...deadline,
      }]);
    } else if (aiDecision.action === "add_subtask" && target) {
      setTasks((current) => current.map((task) => task.id === target.id ? {
        ...task,
        subtasks: [...task.subtasks, {
          id: Date.now(),
          title: aiDecision.title,
          completed: false,
          ...(aiDecision.dueDate ? { dueDate: aiDecision.dueDate, due: deadline.due, dueTone: deadline.dueTone, dueProgress: deadline.dueProgress ?? undefined } : {}),
        }],
      } : task));
    } else if (aiDecision.action === "update_due_date" && target) {
      setTasks((current) => current.map((task) => task.id === target.id ? { ...task, ...deadline } : task));
    } else if (aiDecision.action === "update_priority" && target && aiDecision.priority) {
      setTasks((current) => current.map((task) => task.id === target.id ? { ...task, priority: aiDecision.priority! } : task));
    } else if (aiDecision.action === "complete_task" && target) {
      setSelectedId(target.id);
      if (target.subtasks.some((subtask) => !subtask.completed)) {
        setSheet("warning");
        return;
      }
      completeTask(target.id);
      return;
    } else {
      setAiError("対象のタスクが見つかりません。もう一度、具体的に入力してください。");
      setSheet("ai");
      return;
    }

    setSheet("none");
    setSpeech("");
    setAiDecision(null);
    notify(aiDecision.confirmationMessage);
  }

  function continueClarification() {
    if (!aiDecision?.clarificationQuestion) return;
    setSpeech(`${speech}\n補足：`);
    setSheet("ai");
  }

  return (
    <main className="app-shell">
      <div className={`toast ${toast ? "show" : ""}`} role="status">{toast}</div>

      <div className="app-header">
        <div>
          <p className="eyebrow">{greeting}</p>
          <h1>ぺろんちょOS</h1>
          <p className="date-label">{todayLabel}</p>
        </div>
        <div className="header-actions">
          <button className="icon-button" onClick={() => setSheet("history")} aria-label="完了履歴">↺</button>
          <button className="icon-button" onClick={() => setSheet("settings")} aria-label="設定">⚙</button>
        </div>
      </div>

      <section className="hero-card">
        <div className="hero-orb" />
        <p className="hero-kicker">TODAY&apos;S FOCUS</p>
        <h2>今日やるのは、<br />この{topThree.length}つ</h2>
        <p>期限・重要度・所要時間から<br />AIが選びました。</p>
        <span className="hero-count">{topThree.length}</span>
      </section>

      <section className="section-block">
        <div className="section-title-row">
          <div><p className="section-kicker">PRIORITY</p><h2>今日のトップ3</h2></div>
          <span className="quiet-label">完了すると履歴へ</span>
        </div>
        <div className="task-list featured-list">
          {topThree.map((task, index) => (
            <TaskCard key={task.id} task={task} rank={index + 1} onOpen={openTask} onComplete={requestComplete} onToggleSubtask={toggleSubtask} />
          ))}
        </div>
      </section>

      <section className="section-block other-section">
        <div className="section-title-row">
          <div><p className="section-kicker">ALL TASKS</p><h2>その他のタスク</h2></div>
          <span className="task-count">{Math.max(0, tasks.length - topThree.length)}件</span>
        </div>
        <div className="filters">
          <label><span>並び替え</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option>おすすめ順</option><option>期限が近い順</option><option>優先度順</option><option>新しい順</option></select></label>
          <label><span>カテゴリ</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>すべて</option><option>仕事</option><option>営業</option><option>利用者対応</option><option>生活</option><option>個人</option><option>その他</option></select></label>
        </div>
        <div className="compact-list">
          {others.length ? others.map((task) => (
            <button key={task.id} className="compact-task" onClick={() => openTask(task.id)}>
              <span className="empty-check" /><span className="compact-copy"><strong>{task.title}</strong><small>{task.recurringSource && <span className="recurring-inline">↻ 定例</span>}{task.category} ・ 約{task.minutes}分</small></span><DeadlineMeter due={task.due} dueTone={task.dueTone} dueProgress={task.dueProgress} compact /><span className="chevron">›</span>
            </button>
          )) : <div className="empty-state">該当するタスクはありません</div>}
        </div>
      </section>

      <div className="bottom-actions">
          <button className="manual-button" onClick={() => { setSelectedId(null); setAddAsSubtask(false); setRepeatEnabled(false); setRepeatFrequency("monthly"); setRecurringSubtasks([]); setSheet("manual"); }}><span>＋</span> 手動で追加</button>
        <button className="voice-button" onClick={() => setSheet("ai")}><span className="mic">●</span><span><small>AI ASSISTANT</small>AIに話す</span></button>
      </div>

      {sheet !== "none" && <div className="backdrop" onMouseDown={() => setSheet("none")} />}

      {sheet === "detail" && selected && (
        <div className="sheet large-sheet">
          <SheetHeader title="タスク詳細" onClose={() => setSheet("none")} action={selected.completedAt ? undefined : "編集"} onAction={() => { setAddAsSubtask(false); setRepeatEnabled(false); setSheet("manual"); }} />
          <div className="sheet-body">
            {selected.recurringSource && <span className="recurring-origin-badge">↻ 定例タスクから作成</span>}
            <span className={`detail-due ${selected.dueTone}`}>{selected.due}</span>
            <h2 className="detail-title">{selected.title}</h2>
            <div className="detail-grid"><Detail label="優先度" value={selected.priority} /><Detail label="カテゴリ" value={selected.category} /><Detail label="所要時間" value={`約${selected.minutes}分`} /><Detail label="状態" value={selected.completedAt ? "完了" : "未完了"} /></div>
            {!!selected.subtasks.length && <div className="subtask-panel"><h3>サブタスク</h3>{selected.subtasks.map((sub) => <label className="detail-subtask" key={sub.id}><input type="checkbox" checked={sub.completed} disabled={!!selected.completedAt} onChange={() => toggleSubtask(selected.id, sub.id)} /><span className="subtask-title">{sub.title}</span>{sub.due && <SubtaskDueBadge due={sub.due} dueTone={sub.dueTone} />}</label>)}</div>}
            {!selected.completedAt && <button className="text-action add-subtask-action" onClick={() => { setAddAsSubtask(true); setSheet("manual"); }}>＋ サブタスクを追加</button>}
            {selected.reason && <div className="reason-box"><span>✦ AIの判断理由</span><p>{selected.reason}、今日のトップ3に選ばれています。</p></div>}
            <div className="detail-actions">{selected.completedAt ? <button className="primary-full" onClick={() => restoreTask(selected.id)}>未完了へ戻す</button> : <button className="primary-full" onClick={() => requestComplete(selected.id)}>このタスクを完了</button>}<button className="delete-action" onClick={() => setSheet("delete")}>このタスクを削除</button></div>
          </div>
        </div>
      )}

      {sheet === "manual" && (
        <div className="sheet large-sheet">
          <SheetHeader title={addAsSubtask ? "サブタスクを追加" : selectedId ? "タスクを編集" : "タスクを追加"} onClose={() => setSheet("none")} />
          <form className="sheet-body task-form" onSubmit={addManualTask} key={`${selectedId ?? "new"}-${addAsSubtask}`}>
            <label>タスク名<input name="title" placeholder={addAsSubtask ? "例：担当者へ連絡する" : "例：営業先へ連絡する"} defaultValue={selectedId && !addAsSubtask ? selected?.title : ""} autoFocus /></label>
            {!selectedId && <div className="segmented"><button type="button" className="active">メインタスク</button><button type="button" disabled>サブタスクは詳細から追加</button></div>}
            {addAsSubtask && <div className="parent-task-box"><span>追加先</span><strong>{selected?.title}</strong></div>}
            <label>期限<input name="dueDate" type="date" defaultValue={selectedId && !addAsSubtask ? selected?.dueDate : ""} /></label>
            {!addAsSubtask && <><label>優先度<select name="priority" defaultValue={selectedId ? selected?.priority : "中"}><option>高</option><option>中</option><option>低</option></select></label>
            <label>カテゴリ<select name="category" defaultValue={selectedId ? selected?.category : "その他"}><option>仕事</option><option>営業</option><option>利用者対応</option><option>生活</option><option>個人</option><option>その他</option></select></label>
            <label>所要時間（分）<input name="minutes" type="number" min="1" max="600" defaultValue={selectedId ? selected?.minutes : 15} /></label>
            <label>メモ<textarea name="note" placeholder="必要なことがあれば入力" defaultValue={selectedId ? selected?.note : ""} /></label>
            <label className="repeat-switch"><span><strong>繰り返しタスクにする</strong><small>指定日に通常タスクを自動作成します</small></span><input type="checkbox" checked={repeatEnabled} onChange={(event) => setRepeatEnabled(event.target.checked)} /></label>
            {repeatEnabled && <RecurringFields frequency={repeatFrequency} onFrequencyChange={setRepeatFrequency} />}</>}
            <button className="primary-full" type="submit">{addAsSubtask ? "サブタスクを追加する" : repeatEnabled ? "定例タスクを登録する" : selectedId ? "変更を保存する" : "保存する"}</button>
          </form>
        </div>
      )}

      {sheet === "ai" && (
        <div className="sheet ai-sheet">
          <SheetHeader title="AIに話す" onClose={() => setSheet("none")} />
          <div className="sheet-body ai-input-body">
            <div className="listening-ring"><div className="microphone">●</div></div>
            <h2>何をしてほしいですか？</h2>
            <p>話した内容を、AIがタスクに整理します。</p>
            <label className="speech-input"><span>認識した内容</span><textarea value={speech} maxLength={500} placeholder="例：明日までに営業会議の資料を確認する" onChange={(event) => setSpeech(event.target.value)} /></label>
            {aiError && <div className="ai-error" role="alert">{aiError}</div>}
            <button className="primary-full" disabled={!speech.trim() || aiLoading} onClick={analyzeWithAi}>{aiLoading ? "AIが整理しています…" : "AIに送る"}</button>
          </div>
        </div>
      )}

      {sheet === "confirm" && aiDecision && (
        <div className="sheet large-sheet">
          <SheetHeader title="AIが内容を整理しました" onClose={() => setSheet("none")} />
          <div className="sheet-body">
            <div className="quote-box"><span>あなたの入力</span><p>「{speech}」</p></div>
            <div className="decision-card"><div className="decision-icon">✦</div><div><span>判断した操作</span><h3>{actionLabel(aiDecision.action)}</h3></div></div>
            {aiDecision.action === "ask_clarification" ? (
              <div className="clarification-box"><span>確認させてください</span><p>{aiDecision.clarificationQuestion}</p></div>
            ) : <>
              {aiDecision.targetTaskTitle && <div className="confirm-row"><span>対象タスク</span><strong>{aiDecision.targetTaskTitle}</strong></div>}
              {aiDecision.title && <div className="confirm-row"><span>内容</span><strong>{aiDecision.title}</strong></div>}
              {aiDecision.dueDate && <div className="confirm-row"><span>期限</span><strong>{aiDecision.dueDate}</strong></div>}
              {aiDecision.priority && <div className="confirm-row"><span>優先度</span><strong>{aiDecision.priority}</strong></div>}
            </>}
            <div className="reason-box"><span>判断した理由</span><p>{aiDecision.reason}</p></div>
            <p className="confidence-label">AIの確信度 {Math.round(aiDecision.confidence * 100)}%</p>
            <div className="two-actions"><button onClick={() => setSheet("none")}>キャンセル</button>{aiDecision.action === "ask_clarification" ? <button className="dark" onClick={continueClarification}>補足する</button> : <button className="dark" onClick={applyAiDecision}>この内容で実行</button>}</div>
          </div>
        </div>
      )}

      {sheet === "warning" && selected && (
        <div className="alert-card">
          <div className="alert-symbol">!</div><h2>未完了のサブタスクがあります</h2><p>まだ完了していない項目があります。<br />それでもメインタスクを完了しますか？</p>
          <div className="unfinished-list">{selected.subtasks.filter((sub) => !sub.completed).map((sub) => <span key={sub.id}>○ {sub.title}</span>)}</div>
          <div className="two-actions"><button onClick={() => setSheet("detail")}>キャンセル</button><button className="dark" onClick={() => completeTask(selected.id)}>完了する</button></div>
        </div>
      )}

      {sheet === "delete" && selected && (
        <div className="alert-card">
          <div className="alert-symbol delete-symbol">×</div><h2>このタスクを削除しますか？</h2><p>「{selected.title}」を削除します。<br />この操作は元に戻せません。</p>
          <div className="two-actions"><button onClick={() => setSheet("detail")}>キャンセル</button><button className="danger" onClick={() => deleteTask(selected.id)}>削除する</button></div>
        </div>
      )}

      {sheet === "history" && (
        <div className="sheet large-sheet">
          <SheetHeader title="完了履歴" onClose={() => setSheet("none")} />
          <div className="sheet-body"><div className="search-box">⌕　完了したタスクを検索</div><p className="history-date">最近</p>{history.map((task) => <button className="history-item" key={task.id} onClick={() => { setSelectedId(task.id); setSheet("detail"); }}><span className="done-check">✓</span><span><strong>{task.title}</strong><small>{task.completedAt} 完了</small></span><b>›</b></button>)}</div>
        </div>
      )}

      {sheet === "settings" && (
        <div className="sheet large-sheet">
          <SheetHeader title="設定" onClose={() => setSheet("none")} />
          <div className="sheet-body settings-list"><h3>アカウント</h3><button onClick={() => setSheet("account")}><span>{session ? session.user.email : "ログイン"}<small>{session ? cloudStatusLabel(cloudStatus) : "クラウド保存を利用できます"}</small></span><b>›</b></button><h3>お知らせ</h3><button onClick={() => setSheet("notifications")}><span>プッシュ通知<small>{notificationEnabled ? `毎朝${notificationHour}時に確認` : "オフ"}</small></span><b>›</b></button><h3>表示</h3><button><span>表示名<small>雄哉</small></span><b>›</b></button><button><span>朝の基準時刻<small>午前5:00</small></span><b>›</b></button><h3>タスク</h3><button onClick={() => setSheet("recurringList")}><span>定例タスク<small>{recurringTemplates.filter((template) => template.enabled).length}件が有効</small></span><b>›</b></button><h3>データ</h3><button onClick={exportBackup}><span>バックアップを書き出す<small>タスクと定例設定をファイルに保存</small></span><b>↓</b></button><label className="settings-file-button"><span>バックアップを読み込む<small>保存したJSONファイルから復元</small></span><b>↑</b><input type="file" accept="application/json,.json" onChange={importBackup} /></label><h3>アプリ</h3><button><span>ぺろんちょOS<small>クラウド・通知対応 v0.6</small></span></button></div>
        </div>
      )}

      {sheet === "account" && (
        <div className="sheet large-sheet">
          <SheetHeader title="アカウント" onClose={() => setSheet("settings")} />
          <div className="sheet-body account-panel">
            {session ? <><div className="status-card"><span className="status-dot" /><div><strong>ログイン中</strong><small>{session.user.email}</small><small>{cloudStatusLabel(cloudStatus)}</small></div></div><p>このiPhoneの既存データはクラウドへ保存され、同じメールでログインした端末と同期されます。</p><button className="secondary-full" onClick={signOut}>ログアウト</button></> : <form onSubmit={sendLoginLink} className="task-form"><p>メールアドレスへ届くリンクを押すだけでログインできます。パスワードは不要です。</p><label>メールアドレス<input type="email" required value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="example@email.com" /></label><button className="primary-full" type="submit">ログイン用メールを送る</button>{authMessage && <div className="auth-message">{authMessage}</div>}</form>}
          </div>
        </div>
      )}

      {sheet === "notifications" && (
        <div className="sheet large-sheet">
          <SheetHeader title="お知らせ" onClose={() => setSheet("settings")} />
          <div className="sheet-body notification-panel">
            <div className={`notification-hero ${notificationEnabled ? "enabled" : ""}`}><span>🔔</span><div><strong>{notificationEnabled ? "お知らせは有効です" : "期限をiPhoneへお知らせ"}</strong><small>期限3日前・前日・当日の対象タスクを通知します</small></div></div>
            <label>通知時刻<select value={notificationHour} onChange={(event) => setNotificationHour(Number(event.target.value))}><option value={8}>8:00</option></select></label>
            <p className="notification-note">iPhoneでは、Safariからホーム画面に追加した「ぺろんちょOS」を開いて設定してください。</p>
            <button className="primary-full" onClick={enablePushNotifications}>{notificationEnabled ? "通知設定を更新する" : "お知らせを有効にする"}</button>
            {notificationEnabled && <button className="secondary-full" onClick={sendTestNotification}>テスト通知を送る</button>}
          </div>
        </div>
      )}

      {sheet === "recurringList" && (
        <div className="sheet large-sheet">
          <SheetHeader title="定例タスク" onClose={() => setSheet("settings")} action="＋ 追加" onAction={() => openRecurringEditor(null)} />
          <div className="sheet-body recurring-list">
            <p className="recurring-help">指定日を過ぎて未作成の月があれば、アプリを開いたときに自動で作成します。</p>
            {recurringTemplates.map((template) => {
              const next = getNextOccurrence(template);
              return <article className={`recurring-card ${template.enabled ? "" : "paused"}`} key={template.id}>
                <div className="recurring-card-head"><div><span className="recurring-frequency">↻ {frequencyLabel(template.frequency)}</span><h3>{template.title}</h3></div><label className="mini-switch"><input type="checkbox" checked={template.enabled} onChange={() => toggleRecurring(template.id)} /><span>{template.enabled ? "有効" : "停止"}</span></label></div>
                <dl><div><dt>次回作成日</dt><dd>{formatJapaneseDate(next.createDate)}</dd></div><div><dt>期限</dt><dd>{template.frequency === "monthly" ? `毎月${template.dueDayOfMonth}日` : `作成から${template.dueOffsetDays}日後`}</dd></div><div><dt>期限調整</dt><dd>{adjustmentLabel(template.businessDayAdjustment)}</dd></div></dl>
                <div className="recurring-actions"><button onClick={() => openRecurringEditor(template.id)}>編集</button>{template.frequency === "monthly" && <button onClick={() => createNextMonthTest(template)}>翌月分をテスト</button>}<button className="delete" onClick={() => { setSelectedRecurringId(template.id); setSheet("recurringDelete"); }}>削除</button></div>
              </article>;
            })}
          </div>
        </div>
      )}

      {sheet === "recurringEdit" && (
        <div className="sheet large-sheet">
          <SheetHeader title={selectedRecurringId ? "定例タスクを編集" : "定例タスクを追加"} onClose={() => setSheet("recurringList")} />
          <form className="sheet-body task-form" onSubmit={saveRecurringTemplate} key={selectedRecurringId ?? "new-recurring"}>
            <label>タスク名<input name="title" required placeholder="例：実績を計算する" defaultValue={recurringTemplates.find((template) => template.id === selectedRecurringId)?.title ?? ""} /></label>
            <RecurringFields frequency={repeatFrequency} onFrequencyChange={setRepeatFrequency} template={recurringTemplates.find((template) => template.id === selectedRecurringId)} />
            <button className="primary-full" type="submit">保存する</button>
          </form>
        </div>
      )}

      {sheet === "recurringDelete" && selectedRecurringId && (
        <div className="alert-card"><div className="alert-symbol delete-symbol">×</div><h2>定例タスクを削除しますか？</h2><p>今後の自動作成を停止します。<br />すでに作成された通常タスクは残ります。</p><div className="two-actions"><button onClick={() => setSheet("recurringList")}>キャンセル</button><button className="danger" onClick={() => deleteRecurringTemplate(selectedRecurringId)}>削除する</button></div></div>
      )}
    </main>
  );
}

function TaskCard({ task, rank, onOpen, onComplete, onToggleSubtask }: { task: Task; rank: number; onOpen: (id: number) => void; onComplete: (id: number) => void; onToggleSubtask: (taskId: number, subtaskId: number) => void }) {
  return <article className="task-card">
    <div className="rank-badge">0{rank}</div>
    <div className="task-main-row"><button className="complete-circle" onClick={() => onComplete(task.id)} aria-label={`${task.title}を完了`} /><button className="task-copy" onClick={() => onOpen(task.id)}>{task.recurringSource && <span className="recurring-origin-badge card-badge">↻ 定例</span>}<h3>{task.title}</h3><div className="tag-row"><span className={`priority ${task.priority === "高" ? "high" : task.priority === "中" ? "medium" : "low"}`}>優先度 {task.priority}</span><span>{task.category}</span><span>約{task.minutes}分</span></div></button><DeadlineMeter due={task.due} dueTone={task.dueTone} dueProgress={task.dueProgress} /></div>
    {!!task.subtasks.length && <div className="subtask-list">{task.subtasks.map((sub) => <label key={sub.id}><input type="checkbox" checked={sub.completed} onChange={() => onToggleSubtask(task.id, sub.id)} /><span className="subtask-title">{sub.title}</span>{sub.due && <SubtaskDueBadge due={sub.due} dueTone={sub.dueTone} />}</label>)}</div>}
    {task.reason && <button className="ai-reason" onClick={() => onOpen(task.id)}><span>✦</span>{task.reason}<b>›</b></button>}
  </article>;
}

function DeadlineMeter({ due, dueTone = "none", dueProgress, compact = false }: { due: string; dueTone?: DueTone; dueProgress?: number | null; compact?: boolean }) {
  if (dueProgress === null || dueProgress === undefined) return <span className="due-no-limit">期限なし</span>;

  return <span className={`deadline-meter ${dueTone} ${compact ? "compact" : ""}`} aria-label={`${due}、期限までの残りをバーで表示`}>
    <strong>{due}</strong>
    <span className="deadline-track" aria-hidden="true">
      <span className="deadline-fill" style={{ width: `${dueProgress}%` }} />
    </span>
  </span>;
}

function SubtaskDueBadge({ due, dueTone = "none" }: { due: string; dueTone?: DueTone }) {
  return <span className={`subtask-due-badge ${dueTone}`} aria-label={`サブタスクの期限は${due}`}>{due}</span>;
}

function SheetHeader({ title, onClose, action, onAction }: { title: string; onClose: () => void; action?: string; onAction?: () => void }) {
  return <div className="sheet-header"><button onClick={onClose}>×</button><h2>{title}</h2>{action ? <button className="text-action" onClick={onAction}>{action}</button> : <span />}</div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function RecurringFields({ frequency, onFrequencyChange, template }: { frequency: RecurringFrequency; onFrequencyChange: (frequency: RecurringFrequency) => void; template?: RecurringTemplate }) {
  return <div className="recurring-form-fields">
    <label>繰り返し頻度<select name="frequency" value={frequency} onChange={(event) => onFrequencyChange(event.target.value as RecurringFrequency)}><option value="daily">毎日</option><option value="weekly">毎週</option><option value="monthly">毎月</option><option value="yearly">毎年</option></select></label>
    {frequency === "monthly" && <div className="form-two-columns"><label>毎月の作成日<input name="createDayOfMonth" type="number" min="1" max="31" defaultValue={template?.createDayOfMonth ?? 1} /></label><label>毎月の期限日<input name="dueDayOfMonth" type="number" min="1" max="31" defaultValue={template?.dueDayOfMonth ?? 5} /></label></div>}
    {frequency === "weekly" && <><label>作成する曜日<select name="createDayOfWeek" defaultValue={template?.createDayOfWeek ?? 1}><option value="1">月曜日</option><option value="2">火曜日</option><option value="3">水曜日</option><option value="4">木曜日</option><option value="5">金曜日</option><option value="6">土曜日</option><option value="0">日曜日</option></select></label><label>期限（作成日から何日後）<input name="dueOffsetDays" type="number" min="0" max="365" defaultValue={template?.dueOffsetDays ?? 0} /></label></>}
    {frequency === "daily" && <label>期限（作成日から何日後）<input name="dueOffsetDays" type="number" min="0" max="365" defaultValue={template?.dueOffsetDays ?? 0} /></label>}
    {frequency === "yearly" && <><div className="form-two-columns"><label>作成月<input name="createMonth" type="number" min="1" max="12" defaultValue={template?.createMonth ?? 1} /></label><label>作成日<input name="createDayOfYearMonth" type="number" min="1" max="31" defaultValue={template?.createDayOfYearMonth ?? 1} /></label></div><label>期限（作成日から何日後）<input name="dueOffsetDays" type="number" min="0" max="365" defaultValue={template?.dueOffsetDays ?? 0} /></label></>}
    <label>優先度<select name="priority" defaultValue={template?.priority ?? "中"}><option>高</option><option>中</option><option>低</option></select></label>
    <label>カテゴリ<select name="category" defaultValue={template?.category ?? "仕事"}><option>仕事</option><option>営業</option><option>利用者対応</option><option>生活</option><option>個人</option><option>その他</option></select></label>
    <label>所要時間（分）<input name="minutes" type="number" min="1" max="600" defaultValue={template?.minutes ?? 30} /></label>
    <fieldset className="notification-options"><legend>通知日</legend>{[3, 1, 0].map((day) => <label key={day}><input type="checkbox" name="notificationDays" value={day} defaultChecked={template ? template.notificationDays.includes(day) : true} /><span>{day === 0 ? "当日" : day === 1 ? "前日" : "3日前"}</span></label>)}</fieldset>
    <label>土日祝の場合の期限<select name="businessDayAdjustment" defaultValue={template?.businessDayAdjustment ?? "as_is"}><option value="as_is">そのままの日付</option><option value="previous">前の平日に変更</option><option value="next">次の平日に変更</option></select></label>
    <label>サブタスク（1行に1件）<textarea name="recurringSubtasks" placeholder={"例：資料を集める\n数字を確認する"} defaultValue={template?.subtasks.map((subtask) => subtask.title).join("\n") ?? ""} /></label>
    <label>メモ<textarea name="note" placeholder="必要なことがあれば入力" defaultValue={template?.note ?? ""} /></label>
  </div>;
}

function actionLabel(action: AiAction) {
  return {
    create_task: "新しいタスクを作成",
    add_subtask: "サブタスクを追加",
    update_due_date: "期限を変更",
    update_priority: "優先度を変更",
    complete_task: "タスクを完了",
    ask_clarification: "確認が必要",
  }[action];
}

function cloudStatusLabel(status: "local" | "syncing" | "synced" | "error") {
  return {
    local: "この端末だけに保存",
    syncing: "クラウドへ保存中…",
    synced: "クラウドに保存済み",
    error: "同期できませんでした",
  }[status];
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function taskScore(task: Task) {
  const priorityPoints = task.priority === "高" ? 45 : task.priority === "中" ? 25 : 10;
  const deadlinePoints = task.due.includes("超過") ? 60 : task.dueProgress === null ? 0 : Math.max(0, 48 - task.dueProgress * 0.4);
  const quickWinPoints = Math.max(0, 15 - task.minutes / 4);
  const unfinishedPoints = task.subtasks.filter((subtask) => !subtask.completed).length * 2;
  return priorityPoints + deadlinePoints + quickWinPoints + unfinishedPoints;
}

function topReason(task: Task) {
  const reasons: string[] = [];
  if (task.due.includes("超過")) reasons.push("期限を過ぎている");
  else if (task.dueTone === "urgent") reasons.push("期限が迫っている");
  else if (task.dueTone === "soon") reasons.push("期限が近い");
  if (task.priority === "高") reasons.push("優先度が高い");
  if (task.minutes <= 15) reasons.push("短時間で完了できる");
  if (!reasons.length) reasons.push("他のタスクとのバランスが良い");
  return `${reasons.slice(0, 2).join("うえ、")}ため`;
}

function isTaskArray(value: unknown): value is Task[] {
  return Array.isArray(value) && value.every((task) => {
    if (!task || typeof task !== "object") return false;
    const item = task as Partial<Task>;
    return typeof item.id === "number" && typeof item.title === "string" && typeof item.due === "string" && Array.isArray(item.subtasks);
  });
}

function isRecurringTemplateArray(value: unknown): value is RecurringTemplate[] {
  return Array.isArray(value) && value.every((template) => {
    if (!template || typeof template !== "object") return false;
    const item = template as Partial<RecurringTemplate>;
    return typeof item.id === "string" && typeof item.title === "string" && ["daily", "weekly", "monthly", "yearly"].includes(String(item.frequency)) && Array.isArray(item.subtasks);
  });
}

function recurringTemplateFromForm(form: FormData, existing: RecurringTemplate | null, fallbackSubtasks: string[]): RecurringTemplate {
  const frequency = String(form.get("frequency") ?? "monthly") as RecurringFrequency;
  const today = new Date();
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const subtasksText = String(form.get("recurringSubtasks") ?? "");
  const subtaskTitles = subtasksText.trim() ? subtasksText.split("\n").map((title) => title.trim()).filter(Boolean) : fallbackSubtasks;
  return {
    id: existing?.id ?? `recurring-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: String(form.get("title") ?? existing?.title ?? "").trim(),
    frequency,
    enabled: existing?.enabled ?? true,
    category: String(form.get("category") ?? "仕事"),
    priority: String(form.get("priority") ?? "中") as Task["priority"],
    minutes: Math.max(1, Number(form.get("minutes")) || 30),
    note: String(form.get("note") ?? "").trim(),
    createdAt: existing?.createdAt ?? recurringStartDate(frequency, today, monthStart),
    createDayOfMonth: boundedNumber(form.get("createDayOfMonth"), 1, 31, 1),
    dueDayOfMonth: boundedNumber(form.get("dueDayOfMonth"), 1, 31, 5),
    createDayOfWeek: boundedNumber(form.get("createDayOfWeek"), 0, 6, 1),
    createMonth: boundedNumber(form.get("createMonth"), 1, 12, 1),
    createDayOfYearMonth: boundedNumber(form.get("createDayOfYearMonth"), 1, 31, 1),
    dueOffsetDays: boundedNumber(form.get("dueOffsetDays"), 0, 365, 0),
    notificationDays: form.getAll("notificationDays").map(Number).filter((day) => [0, 1, 3].includes(day)),
    businessDayAdjustment: String(form.get("businessDayAdjustment") ?? "as_is") as BusinessDayAdjustment,
    subtasks: subtaskTitles.map((title, index) => ({ id: `${existing?.id ?? "new"}-sub-${index}-${Date.now()}`, title })),
  };
}

function generateRecurringTasks(templates: RecurringTemplate[], currentTasks: Task[], ledgerEntries: string[], now: Date) {
  const ledger = new Set(ledgerEntries);
  const created: Task[] = [];
  for (const template of templates) {
    const occurrences = getDueOccurrences(template, now, ledger);
    for (const occurrence of occurrences) {
      const key = recurringLedgerKey(template.id, occurrence.periodKey);
      created.push(taskFromOccurrence(template, occurrence, created.length));
      ledger.add(key);
    }
  }
  return { tasks: [...currentTasks, ...created], ledger: [...ledger], createdCount: created.length };
}

function taskFromOccurrence(template: RecurringTemplate, occurrence: RecurringOccurrence, offset = 0): Task {
  return {
    id: Date.now() + offset,
    title: template.title,
    priority: template.priority,
    category: template.category,
    minutes: template.minutes,
    note: template.note,
    subtasks: template.subtasks.map((subtask, index) => ({ id: Date.now() + 10_000 + offset * 100 + index, title: subtask.title, completed: false })),
    recurringSource: { templateId: template.id, periodKey: occurrence.periodKey, notificationDays: template.notificationDays },
    ...createDeadline(occurrence.dueDate),
  };
}

function boundedNumber(value: FormDataEntryValue | null, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function recurringStartDate(frequency: RecurringFrequency, today: Date, monthStart: string) {
  if (frequency === "monthly") return monthStart;
  if (frequency === "yearly") return `${today.getFullYear()}-01-01`;
  if (frequency === "weekly") {
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return localDateText(monday);
  }
  return localDateText(today);
}

function localDateText(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatJapaneseDate(dateText: string) {
  return new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${dateText}T00:00:00`));
}

function createDeadline(dueDate: string): Pick<Task, "due" | "dueTone" | "dueProgress" | "dueDate" | "dueTotalDays"> {
  if (!dueDate) return { due: "期限なし", dueTone: "none", dueProgress: null, dueDate: undefined, dueTotalDays: undefined };
  const remaining = daysUntil(dueDate);
  const total = Math.max(1, remaining);
  return { ...deadlineDisplay(remaining, total), dueDate, dueTotalDays: total };
}

function refreshDeadline(task: Task): Task {
  const subtasks = task.subtasks.map((subtask) => {
    if (!subtask.dueDate) return subtask;
    const display = deadlineDisplay(daysUntil(subtask.dueDate), Math.max(1, daysUntil(subtask.dueDate)));
    return { ...subtask, due: display.due, dueTone: display.dueTone, dueProgress: display.dueProgress ?? undefined };
  });
  if (!task.dueDate) return { ...task, subtasks };
  return { ...task, subtasks, ...deadlineDisplay(daysUntil(task.dueDate), task.dueTotalDays ?? Math.max(1, daysUntil(task.dueDate))) };
}

function deadlineDisplay(remaining: number, total: number): Pick<Task, "due" | "dueTone" | "dueProgress"> {
  const due = remaining < 0 ? `${Math.abs(remaining)}日超過` : remaining === 0 ? "今日まで" : remaining === 1 ? "明日まで" : `あと${remaining}日`;
  const dueTone: DueTone = remaining <= 1 ? "urgent" : remaining <= 5 ? "soon" : "safe";
  const dueProgress = remaining < 0 ? 4 : Math.max(4, Math.min(100, Math.round((remaining / Math.max(1, total)) * 100)));
  return { due, dueTone, dueProgress };
}

function daysUntil(dateText: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateText}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function formatCompletedAt(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
