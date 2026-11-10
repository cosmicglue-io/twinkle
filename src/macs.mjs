// Approximate first-release year for Mac model identifiers, keyed by family and
// major number. Apple Silicon Macs share the generic "Mac" family, so a major
// number spans several products released around the same time.
const YEARS = {
  Mac: { 13: 2022, 14: 2023, 15: 2023, 16: 2024, 17: 2025, 18: 2026 },
  MacBookPro: { 11: 2013, 12: 2015, 13: 2016, 14: 2017, 15: 2018, 16: 2019, 17: 2020, 18: 2021 },
  MacBookAir: { 6: 2013, 7: 2015, 8: 2018, 9: 2020, 10: 2020 },
  MacBook: { 8: 2015, 9: 2016, 10: 2017 },
  iMac: { 14: 2013, 15: 2014, 16: 2015, 17: 2015, 18: 2017, 19: 2019, 20: 2020, 21: 2021 },
  iMacPro: { 1: 2017 },
  Macmini: { 6: 2012, 7: 2014, 8: 2018, 9: 2020 },
  MacPro: { 5: 2010, 6: 2013, 7: 2019 },
};

// M2 MacBook Air and 13-inch MacBook Pro shipped in 2022 under Mac14.
const OVERRIDES = { "Mac14,2": 2022, "Mac14,7": 2022 };

export function modelYear(model) {
  if (!model) return null;
  if (OVERRIDES[model]) return OVERRIDES[model];
  const match = /^([A-Za-z]+)(\d+),\d+$/.exec(model);
  if (!match) return null;
  return YEARS[match[1]]?.[Number(match[2])] ?? null;
}

export function modelYearBucket(model) {
  const year = modelYear(model);
  if (year === null) return "unknown";
  if (year >= 2025) return "2025+";
  if (year >= 2023) return "2023–24";
  if (year >= 2021) return "2021–22";
  if (year >= 2019) return "2019–20";
  if (year >= 2016) return "2016–18";
  return "2015 or earlier";
}

export function modelFamily(model) {
  return model?.replace(/\d+,\d+$/, "") || "unknown";
}

// Mach-O CPU types reported by Sparkle's system profile.
export function architecture(cputype) {
  if (cputype === "16777228") return "Apple Silicon";
  if (cputype === "16777223" || cputype === "7") return "Intel";
  return cputype ? `cputype ${cputype}` : "unknown";
}
