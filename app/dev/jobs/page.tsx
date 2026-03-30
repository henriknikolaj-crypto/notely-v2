import { notFound } from "next/navigation";
import { Suspense } from "react";
import DevJobsClient from "./DevJobsClient";

export default function DevJobsPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <Suspense fallback={null}>
      <DevJobsClient />
    </Suspense>
  );
}
