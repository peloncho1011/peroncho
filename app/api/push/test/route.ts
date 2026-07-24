import webpush from "web-push";

export async function POST(request: Request) {
  const { subscription } = await request.json() as { subscription?: PushSubscriptionJSON };
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!subscription?.endpoint || !publicKey || !privateKey) {
    return Response.json({ error: "通知設定が未完了です" }, { status: 400 });
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  await webpush.sendNotification(subscription as webpush.PushSubscription, JSON.stringify({
    title: "ぺろんちょOS",
    body: "通知テストに成功しました！",
    url: "/",
  }));
  return Response.json({ ok: true });
}

