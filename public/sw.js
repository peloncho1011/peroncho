self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "ぺろんちょOS", {
      body: data.body || "確認したいタスクがあります",
      icon: "/icon-192.png",
      badge: "/favicon.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((windowClient) => "focus" in windowClient);
      if (existing) {
        existing.navigate(event.notification.data?.url || "/");
        return existing.focus();
      }
      return clients.openWindow(event.notification.data?.url || "/");
    }),
  );
});

