import { createRoot } from "react-dom/client";
import "./index.css";

const RECOVERY_KEY = "hms_boot_recovery_attempt";

function isRecoverableBootError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /chunk|module|import|loading|fetch|dynamically imported/i.test(message);
}

async function clearStaleAppShell() {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
    }
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
    }
  } catch (error) {
    console.warn("Could not clear stale HMS app shell", error);
  }
}

async function recoverFromBootFailure(error: unknown) {
  if (!isRecoverableBootError(error) || sessionStorage.getItem(RECOVERY_KEY)) {
    throw error;
  }

  sessionStorage.setItem(RECOVERY_KEY, "1");
  await clearStaleAppShell();

  const url = new URL(window.location.href);
  url.searchParams.set("hms_refresh", Date.now().toString());
  window.location.replace(url.toString());
}

window.addEventListener("error", event => {
  const target = event.target as HTMLElement | null;
  const message = event.message || (target?.tagName === "SCRIPT" ? "script load failed" : "");
  if (isRecoverableBootError(message)) void recoverFromBootFailure(new Error(message));
}, true);

window.addEventListener("unhandledrejection", event => {
  if (isRecoverableBootError(event.reason)) {
    event.preventDefault();
    void recoverFromBootFailure(event.reason);
  }
});

const root = document.getElementById("root");
if (!root) throw new Error("HMS root element is missing");

import("./App.tsx")
  .then(({ default: App }) => {
    sessionStorage.removeItem(RECOVERY_KEY);
    createRoot(root).render(<App />);
  })
  .catch(error => {
    void recoverFromBootFailure(error).catch(() => {
      console.error("HMS could not start", error);
    });
  });
