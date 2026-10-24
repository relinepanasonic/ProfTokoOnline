import { describe, expect, it } from "vitest";
import { adGroupReplaceKey } from "./adGroupReplace";

describe("adGroupReplaceKey", () => {
  it("a named group replaces by its name (unchanged behaviour)", () => {
    expect(adGroupReplaceKey("Grup Hero", "hero")).toEqual({ by: "name", grup_iklan: "Grup Hero" });
    expect(adGroupReplaceKey("  Grup Hero  ", "regular")).toEqual({ by: "name", grup_iklan: "Grup Hero" });
  });

  it("the unnamed GMV Max file replaces the unnamed rows of its level — this is the duplicate bug", () => {
    expect(adGroupReplaceKey(null, "incubation")).toEqual({ by: "level", ads_level: "incubation" });
    expect(adGroupReplaceKey("", "incubation")).toEqual({ by: "level", ads_level: "incubation" });
    expect(adGroupReplaceKey(undefined, "regular")).toEqual({ by: "level", ads_level: "regular" });
  });

  it("nothing identifiable -> nothing is deleted", () => {
    expect(adGroupReplaceKey(null, null)).toBeNull();
    expect(adGroupReplaceKey("   ", "  ")).toBeNull();
  });
});
