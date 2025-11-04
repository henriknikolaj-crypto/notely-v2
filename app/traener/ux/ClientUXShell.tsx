// Server component (ingen "use client" her)
import ClientExamUX from "./ClientExamUX";

type EvalDetails = {
  score: number;
  feedback: string;
  details?: {
    tokens?: number;
    keywords?: string[];
    found?: string[];
    missing?: string[];
  };
} | null;

export default function ClientUXShell({ ownerId }: { ownerId?: string }) {
  // Placeholder-værdier – kan senere sættes ud fra rigtig serverlogik
  const evalRes: EvalDetails = null;
  const answer = "";
  const activeDemoTitle = "Træner";

  return (
    <ClientExamUX
      ownerId={ownerId ?? process.env.DEV_USER_ID ?? ""}
      evalRes={evalRes}
      answer={answer}
      activeDemoTitle={activeDemoTitle}
    />
  );
}
