import { Suspense } from "react";
import ResetPageClient from "./ResetPageClient";

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetPageClient />
    </Suspense>
  );
}
