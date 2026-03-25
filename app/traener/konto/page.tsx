import "server-only";

import { redirect } from "next/navigation";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import { getCanonicalUserPlan, getPlanLimits, normalizePlanCode } from "@/lib/plan/limits";
import KontoUsageSection from "./KontoUsageSection";

export const dynamic = "force-dynamic";

function planLabel(plan: string) {
  if (plan === "pro") return "Pro";
  if (plan === "basis") return "Basis";
  return "Freemium";
}

function planDescription(plan: string) {
  if (plan === "pro") {
    return "Pro giver adgang til Eksamen og de mest avancerede træningsfunktioner.";
  }
  if (plan === "basis") {
    return "Fuld adgang til daglig træning med Træner, Multiple Choice og Flashcards.";
  }
  return "God til at prøve Notely af med begrænset adgang til træning og funktioner.";
}

function planAccessSummary(plan: string, limits: Awaited<ReturnType<typeof getPlanLimits>>) {
  if (plan === "pro") {
    return "Eksamen og avancerede funktioner er inkluderet i Pro.";
  }
  if (plan === "basis") {
    return `Træner, Multiple Choice og Flashcards er åbent. Mundtlig tid: ${limits.oralMinutesPerMonth} min/md.`;
  }
  return `Freemium har begrænset træning med op til ${limits.evalsPerMonth} Træner-evalueringer og ${limits.mcQuestionsPerMonth} MC-spørgsmål pr. måned.`;
}

function resolveSupportEmail() {
  return "info@notely.dk";
}

function buildMailtoHref(email: string, subject: string, bodyLines: string[]) {
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(bodyLines.join("\n"));
  return `mailto:${email}?subject=${encodedSubject}&body=${encodedBody}`;
}

export default async function TrainerAccountPage() {
  const sb = await supabaseServerRSC();
  const {
    data: { user },
  } = await sb.auth.getUser();

  const ownerId = user?.id ?? process.env.DEV_USER_ID ?? null;
  if (!ownerId) redirect("/auth/login");

  const planInfo = await getCanonicalUserPlan(sb, ownerId);
  const plan = normalizePlanCode(planInfo.normalizedPlan);
  const limits = await getPlanLimits(sb, plan);
  const email = user?.email ?? "Ikke tilgængelig";
  const supportEmail = resolveSupportEmail();
  const deleteAccountHref = buildMailtoHref(
    supportEmail,
    "Anmodning om sletning af konto",
    [
      "Hej Notely,",
      "",
      "Jeg vil gerne anmode om sletning af min konto.",
      `Konto: ${email}`,
      `Plan: ${planLabel(plan)}`,
    ],
  );
  const isPaidPlan = plan === "basis" || plan === "pro";

  return (
    <main className="space-y-6">
      <section className="border-b border-zinc-200 pb-3">
        <h1 className="text-lg font-semibold text-zinc-900">Konto</h1>
        <p className="mt-1 text-sm text-zinc-600">
          En enkel oversigt over din konto, dit forbrug og din plan i Notely.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">Konto</h2>
        <dl className="space-y-3">
          <div className="flex items-center justify-between gap-4 border-b border-zinc-100 pb-3">
            <dt className="text-sm text-zinc-600">E-mail</dt>
            <dd className="text-sm font-medium text-zinc-900">{email}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-zinc-600">Plan</dt>
            <dd className="text-sm font-medium text-zinc-900">{planLabel(plan)}</dd>
          </div>
        </dl>
      </section>

      <KontoUsageSection plan={plan === "pro" ? "pro" : plan === "basis" ? "basis" : "freemium"} />

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">Din plan</h2>
        <p className="text-sm leading-7 text-zinc-700">{planDescription(plan)}</p>
        {plan !== "pro" ? <p className="text-sm leading-7 text-zinc-600">{planAccessSummary(plan, limits)}</p> : null}
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">Abonnement</h2>
        {isPaidPlan ? (
          <>
            <p className="text-sm leading-7 text-zinc-700">
              Hvis du vil stoppe dit betalte abonnement, kan du opsige det her.
              Du beholder adgang indtil periodens udløb.
            </p>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex cursor-not-allowed rounded-lg border border-zinc-300 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-500 shadow-sm"
            >
              Opsig abonnement
            </button>
            <p className="text-xs text-zinc-500">
              Opsig abonnement kommer snart. Indtil da kan du skrive til info@notely.dk.
            </p>
          </>
        ) : (
          <p className="text-sm leading-7 text-zinc-700">
            Du er på Freemium og har ikke et aktivt betalt abonnement at opsige.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">Hjælp</h2>
        <p className="text-sm leading-7 text-zinc-700">
          Har du spørgsmål, oplever du fejl eller har du forslag til forbedringer, så skriv gerne til os. Vi bruger din feedback til at gøre Notely bedre.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">Fornyelsesdato</h2>
        <p className="text-sm leading-7 text-zinc-700">
          Når abonnement er aktivt, vises din næste fornyelsesdato her.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">Data og privatliv</h2>
        <p className="text-sm leading-7 text-zinc-700">
          Dine uploads, noter og træningsresultater bruges til at give dig relevante spørgsmål, feedback og overblik over din udvikling. Dine data behandles som en del af din oplevelse i Notely og deles ikke offentligt.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">Slet konto</h2>
        <p className="text-sm leading-7 text-zinc-700">
          Sletning af konto er separat fra opsigelse af abonnement og fjerner din adgang
          og dine tilknyttede data.
        </p>
        <a
          href={deleteAccountHref}
          className="inline-flex rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-100"
        >
          Kontakt om sletning af konto
        </a>
      </section>
    </main>
  );
}
