// Shared helpers for the dynamic chart granularity (month → week/day).
// A single trend series is always homogeneous — all month names, OR all
// week labels, OR all ISO date strings — so one rank function that checks
// each type in turn sorts every mode correctly.

export const MONTH_ORDER = ["Baseline","Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEK_ORDER = ["Baseline (Week 0)","Baseline","Week 1","Week 2","Week 3","Week 4","Week 5"];
const SHORT_MONTH: Record<string, string> = {
  Baseline: "Base", Januari: "Jan", Februari: "Feb", Maret: "Mar", April: "Apr",
  Mei: "Mei", Juni: "Jun", Juli: "Jul", Agustus: "Agu", September: "Sep",
  Oktober: "Okt", November: "Nov", Desember: "Des",
};

export function isIsoDate(label: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(label);
}

// Sort rank: month index, else week index, else the date's epoch (dates
// never coexist with months/weeks in one series, so the large magnitude
// is harmless), else push unknowns to the end.
export function bucketRank(label: string): number {
  const mi = MONTH_ORDER.indexOf(label);
  if (mi >= 0) return mi;
  const wi = WEEK_ORDER.indexOf(label);
  if (wi >= 0) return wi;
  if (isIsoDate(label)) {
    const t = new Date(label.slice(0, 10) + "T00:00:00").getTime();
    if (!Number.isNaN(t)) return t;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function sortByBucket<T>(arr: T[], key: keyof T): T[] {
  return [...(arr || [])].sort((a, b) => bucketRank(String(a[key])) - bucketRank(String(b[key])));
}

// X-axis tick label: day-of-month for ISO dates, short name for months,
// week labels passed through unchanged.
export function bucketAxisLabel(label: string): string {
  if (isIsoDate(label)) return String(new Date(label.slice(0, 10) + "T00:00:00").getDate());
  return SHORT_MONTH[label] ?? label;
}
