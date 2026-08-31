"use client";

import Loader from "@/components/Loader";
import Placeholder from "@/components/Placeholder";
import { useStaffOnly, ProfPerfTabs } from "./shared";

export const dynamic = "force-dynamic";

export default function ProfPerformanceProjectPage() {
  const ready = useStaffOnly();
  if (!ready) return <Loader center />;
  return (
    <>
      <ProfPerfTabs active="/prof-performance" />
      <Placeholder icon="📋" title="Project" desc="Agency-wide project tracking across every Client-tier account — being built next." />
    </>
  );
}
