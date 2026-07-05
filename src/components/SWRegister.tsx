"use client";

import { useEffect } from "react";

// Registers the service worker (public/sw.js). Required for Android Chrome
// to offer the full "Install app" (WebAPK) prompt instead of only a shortcut.
export default function SWRegister() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* ignore */ });
    }
  }, []);
  return null;
}
