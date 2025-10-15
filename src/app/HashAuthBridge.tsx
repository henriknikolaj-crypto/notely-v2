"use client";
import { useEffect } from "react";

export default function HashAuthBridge() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const { pathname, hash } = window.location;
    if (hash && hash.includes("access_token")) {
      // Send hele hash'en videre til /auth/callback (vores client-side handler)
      window.location.replace(`/auth/callback${hash}`);
    }
  }, []);
  return null;
}