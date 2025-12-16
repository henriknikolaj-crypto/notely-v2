// app/HashAuthBridge.tsx
"use client";

import { useEffect } from "react";

export default function HashAuthBridge() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const { hash } = window.location;

    if (hash && hash.includes("access_token")) {
      window.location.replace(`/auth/callback${hash}`);
    }
  }, []);

  return null;
}
