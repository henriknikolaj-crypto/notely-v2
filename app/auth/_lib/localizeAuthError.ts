"use client";

export type AuthErrorContext = "login" | "magic" | "reset" | "signup";

function defaultMessage(context: AuthErrorContext) {
  if (context === "magic") return "Vi kunne ikke sende login-linket. Prøv igen.";
  if (context === "reset") return "Vi kunne ikke sende nulstillingsmailen. Prøv igen.";
  if (context === "signup") return "Noget gik galt. Prøv igen.";
  return "Noget gik galt. Prøv igen.";
}

export function localizeAuthErrorMessage(input: unknown, context: AuthErrorContext): string {
  const raw = String(input ?? "").trim();
  const message = raw.toLowerCase();

  if (!message) return defaultMessage(context);
  if (message.includes("forkert e-mail eller kodeord")) return "Forkert e-mail eller kodeord.";
  if (message.includes("bekræft din e-mail")) return "Bekræft din e-mail, før du logger ind.";
  if (message.includes("der findes allerede en konto")) return "Der findes allerede en konto med den e-mail.";
  if (message.includes("indtast en gyldig e-mailadresse")) return "Indtast en gyldig e-mailadresse.";
  if (message.includes("kodeordet er for kort")) return "Kodeordet er for kort.";
  if (message.includes("du har prøvet for mange gange")) {
    return "Du har prøvet for mange gange. Vent lidt og prøv igen.";
  }
  if (message.includes("linket er udløbet")) return "Linket er udløbet. Bed om et nyt og prøv igen.";
  if (message.includes("invalid login credentials")) return "Forkert e-mail eller kodeord.";
  if (message.includes("email not confirmed")) return "Bekræft din e-mail, før du logger ind.";
  if (message.includes("user already registered")) return "Der findes allerede en konto med den e-mail.";
  if (message.includes("invalid email") || message.includes("unable to validate email address")) {
    return "Indtast en gyldig e-mailadresse.";
  }
  if (message.includes("password should be at least") || message.includes("password is too short")) {
    return "Kodeordet er for kort.";
  }
  if (
    message.includes("security purposes") ||
    message.includes("too many requests") ||
    message.includes("rate limit")
  ) {
    return "Du har prøvet for mange gange. Vent lidt og prøv igen.";
  }
  if (message.includes("otp expired") || message.includes("token has expired") || message.includes("expired")) {
    return "Linket er udløbet. Bed om et nyt og prøv igen.";
  }

  return defaultMessage(context);
}
