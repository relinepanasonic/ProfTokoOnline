// One date format for the whole app:  DD MMM YY   (e.g. "05 Okt 26"),  with time: "05 Okt 26 14:30".
// MMM is the Indonesian short month: Jan Feb Mar Apr Mei Jun Jul Agu Sep Okt Nov Des.
//
// Strings without a timezone ("2026-06-30", "2026-10-07T18:03:00", "2026-10-07 18:03") are
// formatted exactly as written — no Date round-trip, so a date can never shift by a day.
// Strings WITH a timezone ("…Z", "…+07:00") and Date objects are shown in the viewer's local
// time, or in `timeZone` when given (the PDF is built on a server, so it passes "Asia/Jakarta").

const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const p2 = (n: number) => String(n).padStart(2, "0");

type Input = string | Date | null | undefined;
type Parts = { y: number; m: number; d: number; hh: number; mm: number; hasTime: boolean };

function fromDate(date: Date, timeZone?: string): Parts | null {
  if (Number.isNaN(date.getTime())) return null;
  if (!timeZone) {
    return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), hh: date.getHours(), mm: date.getMinutes(), hasTime: true };
  }
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const get = (type: string) => Number(f.formatToParts(date).find((x) => x.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute"), hasTime: true };
}

function parse(v: Input, timeZone?: string): Parts | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return fromDate(v, timeZone);
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const hasTime = m[4] !== undefined;
  if (hasTime && /(Z|[+-]\d{2}:?\d{2})$/.test(s)) return fromDate(new Date(s), timeZone); // has a timezone -> convert
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), hh: hasTime ? Number(m[4]) : 0, mm: hasTime ? Number(m[5]) : 0, hasTime };
}

/** "05 Okt 26", or "—" when there is no (valid) date. */
export function fmtDate(v: Input, timeZone?: string): string {
  const p = parse(v, timeZone);
  if (!p || p.m < 1 || p.m > 12) return "—";
  return `${p2(p.d)} ${MON[p.m - 1]} ${p2(p.y % 100)}`;
}

/** "05 Okt 26 14:30" (date only when the input has no time), or "—". */
export function fmtDateTime(v: Input, timeZone?: string): string {
  const p = parse(v, timeZone);
  if (!p || p.m < 1 || p.m > 12) return "—";
  const day = `${p2(p.d)} ${MON[p.m - 1]} ${p2(p.y % 100)}`;
  return p.hasTime ? `${day} ${p2(p.hh)}:${p2(p.mm)}` : day;
}

/** For chart labels that may be an ISO date ("2026-06-30") or a month / week name: dates get formatted, other labels pass through. */
export function fmtMaybeDate(label: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(label) ? fmtDate(label) : label;
}
