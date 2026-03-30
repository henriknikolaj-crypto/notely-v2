import { notFound } from "next/navigation";
import { Suspense } from "react";
import DevEvaluateClient from "./DevEvaluateClient";

export default function DevEvaluatePage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <Suspense fallback={null}>
      <DevEvaluateClient />
    </Suspense>
  );
}
