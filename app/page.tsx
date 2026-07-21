"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

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
};

const STORAGE_KEY = "peroncho-os-data-v1";

const initialTasks: Task[] = [
  {
    id: 1,
    title: "営業会議の議事録を作る",
    due: "今日まで",
    dueTone: "urgent",
    dueProgress: 4,
    priority: "高",
    category: "仕事",
    minutes: 40,
    reason: "今日が期限で、優先度が高いため",
    subtasks: [
      { id: 11, title: "会議内容を整理する", completed: true },
      { id: 12, title: "議事録の初稿を作る", completed: false, due: "明日まで", dueTone: "urgent", dueProgress: 12 },
    ],
  },
  {
    id: 2,
    title: "藤原さんの福祉用具点検を調整",
    due: "明日まで",
    dueTone: "urgent",
    dueProgress: 12,
    priority: "高",
    category: "利用者対応",
    minutes: 10,
    reason: "期限が近く、短時間で完了できるため",
    subtasks: [
      { id: 21, title: "担当者へ連絡する", completed: false, due: "今日まで", dueTone: "urgent", dueProgress: 4 },
      { id: 22, title: "訪問時間を確認する", completed: false },
    ],
  },
  {
    id: 3,
    title: "ケアマネ営業先リストを更新",
    due: "あと3日",
    dueTone: "soon",
    dueProgress: 30,
    priority: "中",
    category: "営業",
    minutes: 25,
    reason: "今週中の営業準備を進めるため",
    subtasks: [
      { id: 31, title: "新規候補を追加する", completed: false },
      { id: 32, title: "既存のつながりを確認する", completed: false },
    ],
  },
  {
    id: 4,
    title: "訪問予定表を確認する",
    due: "あと5日",
    dueTone: "soon",
    dueProgress: 50,
    priority: "中",
    category: "仕事",
    minutes: 15,
    subtasks: [],
  },
  {
    id: 5,
    title: "週末の買い物リストを作る",
    due: "あと8日",
    dueTone: "safe",
    dueProgress: 80,
    priority: "低",
    category: "生活",
    minutes: 10,
    subtasks: [],
  },
  {
    id: 6,
    title: "新しいAIツールを試す",
    due: "期限なし",
    dueTone: "none",
    dueProgress: null,
    priority: "低",
    category: "個人",
    minutes: 30,
    subtasks: [],
  },
];

const oldHistory: Task[] = [
  {
    id: 91,
    title: "7月の訪問件数を集計する",
    due: "完了",
    dueTone: "none",
    dueProgress: null,
    priority: "中",
    category: "仕事",
    minutes: 20,
    subtasks: [],
    completedAt: "7月19日 17:45",
  },
];

type Sheet = "none" | "detail" | "manual" | "ai" | "confirm" | "history" | "settings" | "warning" | "delete";

export default function Home() {
  const [tasks, setTasks] = useState(initialTasks);
  const [history, setHistory] = useState(oldHistory);
  const [sheet, setSheet] = useState<Sheet>("none");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [speech, setSpeech] = useState("あの営業会議の表を修正するを追加して");
  const [sort, setSort] = useState("おすすめ順");
  const [filter, setFilter] = useState("すべて");
  const [storageReady, setStorageReady] = useState(false);
  const [addAsSubtask, setAddAsSubtask] = useState(false);
  const now = new Date();
  const greeting = now.getHours() < 11 ? "おはようございます" : now.getHours() < 18 ? "こんにちは" : "こんばんは";
  const todayLabel = new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "long" }).format(now);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as { tasks?: Task[]; history?: Task[] };
          if (Array.isArray(parsed.tasks)) setTasks(parsed.tasks.map(refreshDeadline));
          if (Array.isArray(parsed.history)) setHistory(parsed.history);
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, history }));
  }, [tasks, history, storageReady]);

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
    const backup = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tasks, history }, null, 2);
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
      const parsed = JSON.parse(await file.text()) as { tasks?: Task[]; history?: Task[] };
      if (!isTaskArray(parsed.tasks) || !isTaskArray(parsed.history)) throw new Error("invalid backup");
      if (!window.confirm("現在のタスクを、選んだバックアップの内容に置き換えますか？")) return;
      setTasks(parsed.tasks.map(refreshDeadline));
      setHistory(parsed.history);
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

  function addAiSubtask() {
    setTasks((current) =>
      current.map((task) =>
        task.id === 1 && !task.subtasks.some((sub) => sub.title === "営業会議の表を修正する")
          ? { ...task, subtasks: [...task.subtasks, { id: Date.now(), title: "営業会議の表を修正する", completed: false }] }
          : task,
      ),
    );
    setSheet("none");
    notify("営業会議のサブタスクに追加しました");
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
              <span className="empty-check" /><span className="compact-copy"><strong>{task.title}</strong><small>{task.category} ・ 約{task.minutes}分</small></span><DeadlineMeter due={task.due} dueTone={task.dueTone} dueProgress={task.dueProgress} compact /><span className="chevron">›</span>
            </button>
          )) : <div className="empty-state">該当するタスクはありません</div>}
        </div>
      </section>

      <div className="bottom-actions">
          <button className="manual-button" onClick={() => { setSelectedId(null); setAddAsSubtask(false); setSheet("manual"); }}><span>＋</span> 手動で追加</button>
        <button className="voice-button" onClick={() => setSheet("ai")}><span className="mic">●</span><span><small>AI ASSISTANT</small>AIに話す</span></button>
      </div>

      {sheet !== "none" && <div className="backdrop" onMouseDown={() => setSheet("none")} />}

      {sheet === "detail" && selected && (
        <div className="sheet large-sheet">
          <SheetHeader title="タスク詳細" onClose={() => setSheet("none")} action={selected.completedAt ? undefined : "編集"} onAction={() => { setAddAsSubtask(false); setSheet("manual"); }} />
          <div className="sheet-body">
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
            <label>メモ<textarea name="note" placeholder="必要なことがあれば入力" defaultValue={selectedId ? selected?.note : ""} /></label></>}
            <button className="primary-full" type="submit">{addAsSubtask ? "サブタスクを追加する" : selectedId ? "変更を保存する" : "保存する"}</button>
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
            <label className="speech-input"><span>認識した内容</span><textarea value={speech} onChange={(event) => setSpeech(event.target.value)} /></label>
            <button className="primary-full" onClick={() => setSheet("confirm")}>AIに送る</button>
          </div>
        </div>
      )}

      {sheet === "confirm" && (
        <div className="sheet large-sheet">
          <SheetHeader title="AIが内容を整理しました" onClose={() => setSheet("none")} />
          <div className="sheet-body">
            <div className="quote-box"><span>あなたの入力</span><p>「{speech}」</p></div>
            <div className="decision-card"><div className="decision-icon">✦</div><div><span>判断した操作</span><h3>サブタスクを追加</h3></div></div>
            <div className="confirm-row"><span>追加先</span><strong>営業会議の議事録を作る</strong></div>
            <div className="confirm-row"><span>追加内容</span><strong>営業会議の表を修正する</strong></div>
            <div className="reason-box"><span>判断した理由</span><p>営業会議に関係する既存タスクが、この1件だけ見つかったためです。</p></div>
            <div className="two-actions"><button onClick={() => setSheet("none")}>キャンセル</button><button className="dark" onClick={addAiSubtask}>この内容で追加</button></div>
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
          <div className="sheet-body settings-list"><h3>表示</h3><button><span>表示名<small>雄哉</small></span><b>›</b></button><button><span>朝の基準時刻<small>午前5:00</small></span><b>›</b></button><h3>データ</h3><button onClick={exportBackup}><span>バックアップを書き出す<small>タスクをファイルに保存</small></span><b>↓</b></button><label className="settings-file-button"><span>バックアップを読み込む<small>保存したJSONファイルから復元</small></span><b>↑</b><input type="file" accept="application/json,.json" onChange={importBackup} /></label><h3>アプリ</h3><button><span>ぺろんちょOS<small>動作版 v0.2</small></span></button></div>
        </div>
      )}
    </main>
  );
}

function TaskCard({ task, rank, onOpen, onComplete, onToggleSubtask }: { task: Task; rank: number; onOpen: (id: number) => void; onComplete: (id: number) => void; onToggleSubtask: (taskId: number, subtaskId: number) => void }) {
  return <article className="task-card">
    <div className="rank-badge">0{rank}</div>
    <div className="task-main-row"><button className="complete-circle" onClick={() => onComplete(task.id)} aria-label={`${task.title}を完了`} /><button className="task-copy" onClick={() => onOpen(task.id)}><h3>{task.title}</h3><div className="tag-row"><span className={`priority ${task.priority === "高" ? "high" : task.priority === "中" ? "medium" : "low"}`}>優先度 {task.priority}</span><span>{task.category}</span><span>約{task.minutes}分</span></div></button><DeadlineMeter due={task.due} dueTone={task.dueTone} dueProgress={task.dueProgress} /></div>
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
