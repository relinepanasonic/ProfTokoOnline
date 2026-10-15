import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime, fmtMaybeDate } from "./dates";

describe("fmtDate", () => {
  it("formats DD MMM YY with Indonesian months", () => {
    expect(fmtDate("2026-10-05")).toBe("05 Okt 26");
    expect(fmtDate("2026-01-31")).toBe("31 Jan 26");
    expect(fmtDate("2025-12-01")).toBe("01 Des 25");
    expect(fmtDate("2026-08-17")).toBe("17 Agu 26");
    expect(fmtDate("2026-05-09")).toBe("09 Mei 26");
  });

  it("covers all twelve months", () => {
    const out = Array.from({ length: 12 }, (_, i) => fmtDate(`2026-${String(i + 1).padStart(2, "0")}-15`).split(" ")[1]);
    expect(out).toEqual(["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]);
  });

  it("never shifts the day for strings without a timezone (written date wins)", () => {
    expect(fmtDate("2026-03-01")).toBe("01 Mar 26");
    expect(fmtDate("2026-02-28T23:59:00")).toBe("28 Feb 26");
    expect(fmtDate("2026-10-07 18:03:00")).toBe("07 Okt 26");
  });

  it("returns an em dash for empty or invalid input", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
    expect(fmtDate("")).toBe("—");
    expect(fmtDate("not a date")).toBe("—");
    expect(fmtDate("2026-13-40")).toBe("—");
  });

  it("converts timestamps that carry a timezone, in a chosen zone", () => {
    expect(fmtDate("2026-10-12T17:30:00Z", "Asia/Jakarta")).toBe("13 Okt 26"); // 00:30 next day in WIB
    expect(fmtDate(new Date("2026-10-12T17:30:00Z"), "Asia/Jakarta")).toBe("13 Okt 26");
    expect(fmtDate(new Date("2026-10-12T05:00:00Z"), "UTC")).toBe("12 Okt 26");
  });
});

describe("fmtDateTime", () => {
  it("adds 24-hour time when the input has one", () => {
    expect(fmtDateTime("2026-10-07T18:03:00")).toBe("07 Okt 26 18:03");
    expect(fmtDateTime("2026-10-07 08:05")).toBe("07 Okt 26 08:05");
    expect(fmtDateTime("2026-10-12T17:30:00Z", "Asia/Jakarta")).toBe("13 Okt 26 00:30");
  });
  it("gives only the date when the input has no time", () => {
    expect(fmtDateTime("2026-10-07")).toBe("07 Okt 26");
  });
  it("em dash when missing", () => {
    expect(fmtDateTime(null)).toBe("—");
  });
});

describe("fmtMaybeDate", () => {
  it("formats ISO dates and passes month / week labels through", () => {
    expect(fmtMaybeDate("2026-06-30")).toBe("30 Jun 26");
    expect(fmtMaybeDate("Januari")).toBe("Januari");
    expect(fmtMaybeDate("Week 3")).toBe("Week 3");
  });
});
