import { Suspense } from "react";
import SignupPageClient from "./SignupPageClient";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageClient />
    </Suspense>
  );
}
