import type { ReactNode } from "react";
import HeaderBar from "@/app/HeaderBar";
import AppToaster from "@/app/_ui/Toaster";

/** 
 * AppShell — fælles layout med header, luft og centrering 
 * Bruges af f.eks. Notes og Courses sider.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[#fafafa] text-[#1b1b1b]">
      <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-8 space-y-6">
        {children}
      </main>
      <AppToaster />
    </div>
  );
}
