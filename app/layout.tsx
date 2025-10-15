import "./globals.css";
import type { Metadata } from "next";
import ServerHeader from "./components/Header";
export const metadata: Metadata = {
  title: "Notely",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body className="min-h-screen bg-[#fffef9] text-neutral-900">
        {/* Header */}
        {/* @ts-expect-error Server Component */}
        <ServerHeader />
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}


