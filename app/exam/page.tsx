/* eslint-disable @typescript-eslint/no-explicit-any */
import ClientExamUX from "@/app/exam/ClientExamUX";
import RecentEvaluations from "@/app/exam/RecentEvaluations";

export default function Page() {
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-8">
      <ClientExamUX />
      <RecentEvaluations />
    </main>
  );
}


