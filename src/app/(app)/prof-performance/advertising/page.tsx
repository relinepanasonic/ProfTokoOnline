"use client";

import Loader from "@/components/Loader";
import Placeholder from "@/components/Placeholder";
import { useStaffOnly, ProfPerfTabs } from "../shared";

export const dynamic = "force-dynamic";

export default function ProfPerformanceAdvertisingPage() {
  const ready = useStaffOnly();
  if (!ready) return <Loader center />;
  return (
    <>
      <ProfPerfTabs active="/prof-performance/advertising" />
      <Placeholder icon="🎯" title="Advertising" desc="Agency-wide ads performance across every Client-tier account — being built next." />
    </>
  );
}
