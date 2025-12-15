// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { Inter, Birthstone } from "next/font/google";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Notely.",
  description: "Studieassistent / Eksamens­træner",
};

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

const logo = Birthstone({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-logo",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="da">
      <body
        className={`${inter.className} ${logo.variable} min-h-screen bg-[#fffef9] text-zinc-900 antialiased selection:bg-black selection:text-white`}
      >
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
