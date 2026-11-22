import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0];
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const serviceWorker = self as unknown as {
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  skipWaiting: () => Promise<void>;
};

serviceWorker.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    serviceWorker.skipWaiting();
  }
});
