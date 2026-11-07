/* RapidShift Labs — W3C Web Push Service Worker (VAPID + aes128gcm) */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "RapidShift Labs",
    body: "You have a new business update.",
    url: "/",
    tag: "rsl-push",
    icon: "/logo.png",
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        payload = {
          title: parsed.title || payload.title,
          body: parsed.body || payload.body,
          url: parsed.url || payload.url,
          tag: parsed.tag || payload.tag,
          icon: parsed.icon || payload.icon,
        };
      }
    } catch {
      const rawText = event.data.text();
      if (rawText) payload.body = rawText;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || "/logo.png",
      badge: "/logo.png",
      tag: payload.tag || "rsl-push",
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
