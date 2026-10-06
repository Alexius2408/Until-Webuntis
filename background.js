const ext = globalThis.browser ?? globalThis.chrome;

ext.runtime.onMessage.addListener((message) => {
  if (message.type !== "showNotification") return;

  ext.notifications.create({
    type: "basic",
    iconUrl: ext.runtime.getURL("icons/icon-128.png"),
    title: message.title,
    message: message.text
  });
});