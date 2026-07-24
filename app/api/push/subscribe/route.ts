import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !token) return Response.json({ error: "ログインが必要です" }, { status: 401 });

  const supabase = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return Response.json({ error: "ログインが必要です" }, { status: 401 });

  const body = await request.json() as { subscription?: PushSubscriptionJSON; notificationHour?: number };
  if (!body.subscription?.endpoint) return Response.json({ error: "通知情報がありません" }, { status: 400 });
  const { error } = await supabase.from("push_subscriptions").upsert({
    user_id: user.id,
    endpoint: body.subscription.endpoint,
    subscription: body.subscription,
    notification_hour: Math.min(23, Math.max(0, body.notificationHour ?? 8)),
    timezone: "Asia/Tokyo",
    enabled: true,
  }, { onConflict: "user_id,endpoint" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

