import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

type Task = { id: number; title: string; dueDate?: string; recurringSource?: { notificationDays?: number[] } };

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected && request.headers.get("authorization") !== `Bearer ${expected}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!url || !serviceKey || !publicKey || !privateKey) return Response.json({ error: "env missing" }, { status: 500 });

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey, privateKey);
  const db = createClient(url, serviceKey);
  const { data: subscriptions } = await db.from("push_subscriptions").select("*").eq("enabled", true);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  let sent = 0;

  for (const item of subscriptions ?? []) {
    const { data: state } = await db.from("user_app_state").select("payload").eq("user_id", item.user_id).maybeSingle();
    const tasks = (state?.payload?.tasks ?? []) as Task[];
    const due = tasks.filter((task) => task.dueDate && notificationDays(task).includes(dayDifference(today, task.dueDate)));
    if (!due.length) continue;
    const fingerprint = `${today}:${due.map((task) => task.id).sort().join(",")}`;
    if (item.last_notification_key === fingerprint) continue;
    try {
      await webpush.sendNotification(item.subscription, JSON.stringify({
        title: "ぺろんちょOS",
        body: due.length === 1 ? `「${due[0].title}」の期限を確認しましょう` : `期限が近いタスクが${due.length}件あります`,
        url: "/",
      }));
      await db.from("push_subscriptions").update({ last_notification_key: fingerprint }).eq("id", item.id);
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.from("push_subscriptions").update({ enabled: false }).eq("id", item.id);
    }
  }
  return Response.json({ ok: true, sent });
}

function notificationDays(task: Task) {
  return task.recurringSource?.notificationDays?.length ? task.recurringSource.notificationDays : [3, 1, 0];
}

function dayDifference(from: string, to: string) {
  const a = new Date(`${from}T00:00:00+09:00`).getTime();
  const b = new Date(`${to}T00:00:00+09:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

