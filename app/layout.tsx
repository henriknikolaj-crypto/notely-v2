// app/layout.tsx
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Notely.",
  description: "Studieassistent / Eksamens­træner",
};

const bodyStyle: CSSProperties & Record<"--font-logo" | "--font-birthstone", string> = {
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "--font-birthstone": '"Brush Script MT", "Segoe Script", cursive',
  "--font-logo": 'var(--font-birthstone)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="da">
      <body
        style={bodyStyle}
        className="min-h-screen bg-[#fffef9] text-zinc-900 antialiased selection:bg-black selection:text-white"
      >
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
