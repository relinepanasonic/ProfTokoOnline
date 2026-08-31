"use client";

import Loader from "@/components/Loader";
import Placeholder from "@/components/Placeholder";
import { useStaffOnly, ProfPerfTabs } from "../shared";

export const dynamic = "force-dynamic";

export default function ProfPerformanceAdminPage() {
  const ready = useStaffOnly();
  if (!ready) return <Loader center />;
  return (
    <>
      <ProfPerfTabs active="/prof-performance/admin" />
      <Placeholder icon="🛠️" title="Admin" desc="Agency-wide admin/ops tracking across every Client-tier account — being built next." />
    </>
  );
}
