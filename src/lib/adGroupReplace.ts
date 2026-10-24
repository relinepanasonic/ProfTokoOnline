// Which existing ad_groups rows does a freshly uploaded ad-group file REPLACE?
// (the "Data Grup Iklan" / Shop GMV Max exports, /api/ads-group/upload)
//
// A re-upload of the same file for the same store + week must replace the old rows, otherwise every
// number is doubled (that is what made "Independent Ads" negative: Total − GMV Max − Group, with a
// GMV Max counted twice).
//  * a file with a group name (grup_iklan)  -> replaces the rows of that group name
//    (several named groups legitimately share one week and must not delete each other);
//  * a file WITHOUT a name (the GMV Max "Inkubasi" file and unnamed "Grup Iklan" files) -> replaces the
//    unnamed rows of the same ads_level — there is one such file per level per store per week;
//  * neither -> nothing can be identified, so nothing is deleted.
export type AdGroupReplaceKey =
  | { by: "name"; grup_iklan: string }
  | { by: "level"; ads_level: string }
  | null;

export function adGroupReplaceKey(grupIklan: string | null | undefined, adsLevel: string | null | undefined): AdGroupReplaceKey {
  const name = (grupIklan ?? "").trim();
  if (name) return { by: "name", grup_iklan: name };
  const level = (adsLevel ?? "").trim();
  if (level) return { by: "level", ads_level: level };
  return null;
}
