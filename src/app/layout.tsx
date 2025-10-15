import "./globals.css";
import type { Metadata } from "next";
import HeaderBar from "./HeaderBar";
import AppToaster from "./_ui/Toaster";

export const metadata: Metadata = { title: "Notely" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body className="bg-white text-gray-900 antialiased">
        <HeaderBar />
        <main className="mx-auto max-w-4xl px-4 py-6">
          {children}
        </main>
        <AppToaster />
      </body>
    </html>
  );
}