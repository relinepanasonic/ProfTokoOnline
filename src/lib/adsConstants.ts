// Shared between the Ads Performance page and the Ads-Group upload widget
// (rendered both on /ads and on the consolidated /upload page).
export const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
export const MONTH_ORDER = ["Baseline", ...MONTHS];
export const WEEKS = ["Week 1","Week 2","Week 3","Week 4","Week 5"];

export type AdLevel = { v: string; l: string; c: string };
export const LEVELS: AdLevel[] = [
  { v: "incubation",     l: "Incubation",     c: "#3b82f6" },
  { v: "hero",           l: "Hero",           c: "#c9a227" },
  { v: "regular",        l: "Independent Ads", c: "#8b5cf6" },
  { v: "low_conversion", l: "Low Conversion", c: "#ef4444" },
];
export const levelMeta = (v: string | null) => LEVELS.find((x) => x.v === v);
