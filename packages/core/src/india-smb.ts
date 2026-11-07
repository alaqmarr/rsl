/**
 * India Open SMB Utilities (`$0` Forever Public Standards & Datasets):
 * 1. Official GSTN Modulo-36 Checksum Validator, State Extractor & PAN Parser
 * 2. Curated CBIC HSN & SAC Directory + Official GST Slab Lookup (in bps)
 * 3. Razorpay Open IFSC Directory Lookup (`https://ifsc.razorpay.com/{IFSC}`)
 * 4. India Post PIN Code -> City, District & 2-Digit GST State Code Lookup (`https://api.postalpincode.in/pincode/{PIN}`)
 * 5. Frankfurter Open ECB Live Forex Reference API (`https://api.frankfurter.dev/v1/latest`)
 */

export const INDIA_GST_STATE_NAMES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Dadra & Nagar Haveli and Daman & Diu",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (Old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

const STATE_NAME_TO_GST_CODE: Record<string, string> = {
  "jammu and kashmir": "01",
  "jammu & kashmir": "01",
  "himachal pradesh": "02",
  punjab: "03",
  chandigarh: "04",
  uttarakhand: "05",
  uttaranchal: "05",
  haryana: "06",
  delhi: "07",
  "new delhi": "07",
  "nct of delhi": "07",
  rajasthan: "08",
  "uttar pradesh": "09",
  bihar: "10",
  sikkim: "11",
  "arunachal pradesh": "12",
  nagaland: "13",
  manipur: "14",
  mizoram: "15",
  tripura: "16",
  meghalaya: "17",
  assam: "18",
  "west bengal": "19",
  jharkhand: "20",
  odisha: "21",
  orissa: "21",
  chhattisgarh: "22",
  "madhya pradesh": "23",
  gujarat: "24",
  "daman and diu": "26",
  "dadra and nagar haveli": "26",
  "the dadra and nagar haveli and daman and diu": "26",
  maharashtra: "27",
  karnataka: "29",
  goa: "30",
  lakshadweep: "31",
  kerala: "32",
  "tamil nadu": "33",
  tamilnadu: "33",
  puducherry: "34",
  pondicherry: "34",
  "andaman and nicobar islands": "35",
  "andaman & nicobar islands": "35",
  telangana: "36",
  "andhra pradesh": "37",
  ladakh: "38",
};

export function resolveGstStateCodeFromName(stateName: string | null | undefined): string | null {
  if (!stateName) return null;
  const clean = stateName.trim().toLowerCase().replace(/\s+/g, " ");
  if (STATE_NAME_TO_GST_CODE[clean]) return STATE_NAME_TO_GST_CODE[clean]!;
  for (const [key, code] of Object.entries(STATE_NAME_TO_GST_CODE)) {
    if (clean.includes(key) || key.includes(clean)) {
      return code;
    }
  }
  return null;
}

/* ============================================================================
 * 1. Official GSTN Modulo-36 Checksum Algorithm
 * ============================================================================ */

const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_FORMAT_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Computes the official 15th Modulo-36 check character for a 14-character GSTIN prefix.
 */
export function computeGstinCheckDigit(first14Raw: string): string | null {
  const prefix = first14Raw.trim().toUpperCase();
  if (prefix.length !== 14) return null;

  let factor = 1;
  let total = 0;
  const base = GSTIN_ALPHABET.length; // 36

  for (let i = 0; i < 14; i++) {
    const codePoint = GSTIN_ALPHABET.indexOf(prefix[i]!);
    if (codePoint < 0) return null;
    const digit = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    const quotient = Math.floor(digit / base);
    const remainder = digit % base;
    total += quotient + remainder;
  }

  const mod = total % base;
  const checkCodePoint = (base - mod) % base;
  return GSTIN_ALPHABET[checkCodePoint] ?? null;
}

export interface GstinValidationResult {
  normalized: string;
  formatValid: boolean;
  checksumValid: boolean;
  isValid: boolean;
  stateCode: string | null;
  stateName: string | null;
  pan: string | null;
  entityCode: string | null;
  expectedCheckDigit: string | null;
  suggestedGstin: string | null;
  error: string | null;
}

export function validateIndianGstin(
  rawGstin: string | null | undefined,
  options?: { expectedStateCode?: string; strictChecksum?: boolean }
): GstinValidationResult {
  const normalized = (rawGstin || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized) {
    return {
      normalized: "",
      formatValid: false,
      checksumValid: false,
      isValid: false,
      stateCode: null,
      stateName: null,
      pan: null,
      entityCode: null,
      expectedCheckDigit: null,
      suggestedGstin: null,
      error: "GSTIN is empty.",
    };
  }

  const formatValid = GSTIN_FORMAT_REGEX.test(normalized);
  const stateCode = normalized.length >= 2 ? normalized.slice(0, 2) : null;
  const stateName = stateCode ? (INDIA_GST_STATE_NAMES[stateCode] ?? null) : null;

  if (!formatValid || !stateName) {
    return {
      normalized,
      formatValid: false,
      checksumValid: false,
      isValid: false,
      stateCode,
      stateName,
      pan: normalized.length >= 12 ? normalized.slice(2, 12) : null,
      entityCode: normalized.length >= 13 ? normalized[12]! : null,
      expectedCheckDigit:
        normalized.length >= 14 ? computeGstinCheckDigit(normalized.slice(0, 14)) : null,
      suggestedGstin: null,
      error: !stateName
        ? `Invalid 2-digit Indian GST State Code '${stateCode ?? ""}'.`
        : "GSTIN must be 15 characters matching 2-digit State + 10-char PAN + Entity + Z + Check Digit (e.g. 27AABCU9603R1ZM).",
    };
  }

  const expectedCheckDigit = computeGstinCheckDigit(normalized.slice(0, 14));
  const actualCheckDigit = normalized[14]!;
  const checksumValid = Boolean(expectedCheckDigit && actualCheckDigit === expectedCheckDigit);
  const suggestedGstin = expectedCheckDigit ? `${normalized.slice(0, 14)}${expectedCheckDigit}` : null;
  const pan = normalized.slice(2, 12);
  const entityCode = normalized[12]!;

  if (options?.expectedStateCode && options.expectedStateCode.trim() && stateCode !== options.expectedStateCode.trim()) {
    return {
      normalized,
      formatValid: true,
      checksumValid,
      isValid: false,
      stateCode,
      stateName,
      pan,
      entityCode,
      expectedCheckDigit,
      suggestedGstin,
      error: `GSTIN state prefix ${stateCode} (${stateName}) does not match selected state ${options.expectedStateCode}.`,
    };
  }

  const requireChecksum = options?.strictChecksum !== false;
  const isValid = requireChecksum ? checksumValid : formatValid;

  return {
    normalized,
    formatValid: true,
    checksumValid,
    isValid,
    stateCode,
    stateName,
    pan,
    entityCode,
    expectedCheckDigit,
    suggestedGstin,
    error: !checksumValid
      ? `Modulo-36 check digit mismatch: ends with '${actualCheckDigit}', expected '${expectedCheckDigit}' (${suggestedGstin}).`
      : null,
  };
}

/* ============================================================================
 * 2. Curated CBIC HSN (Goods) & SAC (Services) Catalog + Official GST Slabs
 * ============================================================================ */

export interface HsnSacCatalogEntry {
  code: string;
  kind: "HSN" | "SAC";
  description: string;
  category: string;
  gstRateBps: number; // e.g. 1800 = 18%, 1200 = 12%, 500 = 5%, 2800 = 28%, 0 = 0%
  defaultUom: string;
}

export const INDIA_HSN_SAC_CATALOG: readonly HsnSacCatalogEntry[] = [
  // Food, FMCG & Kirana
  { code: "1006", kind: "HSN", description: "Rice (unbranded / loose bulk)", category: "Food & Grains", gstRateBps: 0, defaultUom: "KGS" },
  { code: "100630", kind: "HSN", description: "Pre-packaged & labelled Rice (<= 25 kg)", category: "Food & Grains", gstRateBps: 500, defaultUom: "BAG" },
  { code: "1001", kind: "HSN", description: "Wheat and Meslin (pre-packaged labelled)", category: "Food & Grains", gstRateBps: 500, defaultUom: "BAG" },
  { code: "1101", kind: "HSN", description: "Wheat or Meslin Flour (Atta, Maida, Besan labelled)", category: "Food & Grains", gstRateBps: 500, defaultUom: "KGS" },
  { code: "0902", kind: "HSN", description: "Tea (Black / Green packaged leaf & dust)", category: "Beverages & Spices", gstRateBps: 500, defaultUom: "KGS" },
  { code: "0910", kind: "HSN", description: "Turmeric, Ginger, Curry Spices & Masala Blends", category: "Beverages & Spices", gstRateBps: 500, defaultUom: "KGS" },
  { code: "1512", kind: "HSN", description: "Edible Sunflower, Groundnut, Mustard & Soybean Oil", category: "FMCG & Oils", gstRateBps: 500, defaultUom: "LTR" },
  { code: "1701", kind: "HSN", description: "Cane or Beet Sugar (Refined)", category: "Food & Grains", gstRateBps: 500, defaultUom: "KGS" },
  { code: "1905", kind: "HSN", description: "Biscuits, Cakes, Rusks & Bakery Products", category: "FMCG & Bakery", gstRateBps: 1800, defaultUom: "PKT" },
  { code: "2106", kind: "HSN", description: "Namkeen, Bhujia, Packaged Snacks & Food Preparations", category: "FMCG & Snacks", gstRateBps: 1200, defaultUom: "PKT" },
  { code: "3304", kind: "HSN", description: "Cosmetics, Skin Care & Personal Beauty Preparations", category: "Personal Care", gstRateBps: 1800, defaultUom: "PCS" },
  { code: "3401", kind: "HSN", description: "Toilet Soap, Liquid Handwash & Bathing Bars", category: "Personal Care", gstRateBps: 1800, defaultUom: "PCS" },
  { code: "3402", kind: "HSN", description: "Detergent Washing Powder, Liquid & Surface Cleaners", category: "Home Care", gstRateBps: 1800, defaultUom: "KGS" },

  // Pharmaceuticals & Medical
  { code: "3004", kind: "HSN", description: "Medicaments / Pharmaceutical Formulations (Tablets, Syrups)", category: "Pharma & Healthcare", gstRateBps: 1200, defaultUom: "BOX" },
  { code: "3005", kind: "HSN", description: "Medical Bandages, Gauze, Surgical Dressings", category: "Pharma & Healthcare", gstRateBps: 1200, defaultUom: "PKT" },
  { code: "9018", kind: "HSN", description: "Medical, Surgical & Diagnostic Instruments / Devices", category: "Pharma & Healthcare", gstRateBps: 1200, defaultUom: "PCS" },

  // Textiles, Garments & Footwear
  { code: "5208", kind: "HSN", description: "Woven Cotton Fabrics", category: "Textiles & Apparel", gstRateBps: 500, defaultUom: "MTR" },
  { code: "5407", kind: "HSN", description: "Synthetic / Polyester Woven Fabrics", category: "Textiles & Apparel", gstRateBps: 500, defaultUom: "MTR" },
  { code: "6109", kind: "HSN", description: "T-Shirts, Vests & Knitted Garments (<= Rs 1,000)", category: "Textiles & Apparel", gstRateBps: 500, defaultUom: "PCS" },
  { code: "6203", kind: "HSN", description: "Readymade Suits, Trousers, Shirts & Apparel (> Rs 1,000)", category: "Textiles & Apparel", gstRateBps: 1200, defaultUom: "PCS" },
  { code: "6403", kind: "HSN", description: "Footwear (> Rs 1,000 per pair)", category: "Footwear", gstRateBps: 1800, defaultUom: "PAR" },

  // Industrial, Chemicals, Plastics, Paper & Packaging
  { code: "2523", kind: "HSN", description: "Portland Cement, White Cement & Clinkers", category: "Construction & Building", gstRateBps: 2800, defaultUom: "BAG" },
  { code: "3208", kind: "HSN", description: "Industrial & Decorative Paints, Varnishes & Enamels", category: "Construction & Chemicals", gstRateBps: 1800, defaultUom: "LTR" },
  { code: "3808", kind: "HSN", description: "Agrochemicals, Insecticides, Herbicides & Disinfectants", category: "Agri & Chemicals", gstRateBps: 1800, defaultUom: "LTR" },
  { code: "3917", kind: "HSN", description: "PVC / HDPE Pipes, Tubes, Hoses & Plastic Fittings", category: "Plastics & Plumbing", gstRateBps: 1800, defaultUom: "MTR" },
  { code: "3923", kind: "HSN", description: "Plastic Packaging Boxes, Bottles, Crates & Polybags", category: "Packaging", gstRateBps: 1800, defaultUom: "PCS" },
  { code: "4819", kind: "HSN", description: "Corrugated Paper Cartons, Printed Packaging Boxes", category: "Packaging & Paper", gstRateBps: 1800, defaultUom: "PCS" },
  { code: "4820", kind: "HSN", description: "Registers, Account Books, Notebooks & Stationery", category: "Packaging & Paper", gstRateBps: 1200, defaultUom: "PCS" },

  // Metals, Hardware, Industrial Machinery & Auto Parts
  { code: "6907", kind: "HSN", description: "Ceramic & Vitrified Floor / Wall Tiles", category: "Construction & Building", gstRateBps: 1800, defaultUom: "BOX" },
  { code: "7214", kind: "HSN", description: "TMT Bars, Iron & Non-Alloy Steel Rods / Angles", category: "Iron, Steel & Metals", gstRateBps: 1800, defaultUom: "TON" },
  { code: "7304", kind: "HSN", description: "MS / Stainless Steel Seamless Pipes & Tubes", category: "Iron, Steel & Metals", gstRateBps: 1800, defaultUom: "MTR" },
  { code: "7318", kind: "HSN", description: "Screws, Bolts, Nuts, Washers, Rivets & Fasteners", category: "Hardware & Tools", gstRateBps: 1800, defaultUom: "KGS" },
  { code: "8205", kind: "HSN", description: "Hand Tools (Spanners, Hammers, Pliers, Drilling Tools)", category: "Hardware & Tools", gstRateBps: 1800, defaultUom: "PCS" },
  { code: "8413", kind: "HSN", description: "Submersible, Centrifugal & Industrial Water Pumps", category: "Machinery & Industrial", gstRateBps: 1800, defaultUom: "NOS" },
  { code: "8415", kind: "HSN", description: "Air Conditioners (Split / Window / Commercial HVAC)", category: "Appliances & Electronics", gstRateBps: 2800, defaultUom: "NOS" },
  { code: "8471", kind: "HSN", description: "Laptops, Desktops, Servers & Computer Peripherals", category: "IT & Electronics", gstRateBps: 1800, defaultUom: "NOS" },
  { code: "8481", kind: "HSN", description: "Industrial Valves, Taps, Cocks & Sanitary Fittings", category: "Machinery & Industrial", gstRateBps: 1800, defaultUom: "PCS" },
  { code: "8482", kind: "HSN", description: "Ball, Roller & Needle Bearings", category: "Machinery & Industrial", gstRateBps: 1800, defaultUom: "PCS" },
  { code: "8504", kind: "HSN", description: "Transformers, Inverters, UPS & Power Supplies", category: "Electricals", gstRateBps: 1800, defaultUom: "NOS" },
  { code: "8507", kind: "HSN", description: "Lead-Acid & Lithium-Ion Inverter / Automotive Batteries", category: "Electricals & Auto", gstRateBps: 1800, defaultUom: "NOS" },
  { code: "8517", kind: "HSN", description: "Smartphones, Routers & Networking Equipment", category: "IT & Electronics", gstRateBps: 1800, defaultUom: "NOS" },
  { code: "8536", kind: "HSN", description: "Electrical Switches, MCBs, Relays, Sockets & Switchgear", category: "Electricals", gstRateBps: 1800, defaultUom: "PCS" },
  { code: "8539", kind: "HSN", description: "LED Bulbs, Tube Lights & Luminaires", category: "Electricals", gstRateBps: 1200, defaultUom: "PCS" },
  { code: "8544", kind: "HSN", description: "Insulated Copper / Aluminium Electrical Wires & Cables", category: "Electricals", gstRateBps: 1800, defaultUom: "MTR" },
  { code: "8708", kind: "HSN", description: "Motor Vehicle Parts & Accessories", category: "Automotive", gstRateBps: 2800, defaultUom: "PCS" },
  { code: "9403", kind: "HSN", description: "Office, Wooden & Modular Steel Furniture", category: "Furniture", gstRateBps: 1800, defaultUom: "NOS" },

  // SAC Service Codes
  { code: "9965", kind: "SAC", description: "Goods Transport Agency (GTA) Road Freight Services", category: "Logistics & Transport", gstRateBps: 1200, defaultUom: "OTH" },
  { code: "9972", kind: "SAC", description: "Commercial Property / Warehouse Rental & Leasing", category: "Real Estate", gstRateBps: 1800, defaultUom: "OTH" },
  { code: "9982", kind: "SAC", description: "Accounting, Auditing, Bookkeeping & Tax Consultancy", category: "Professional Services", gstRateBps: 1800, defaultUom: "OTH" },
  { code: "998313", kind: "SAC", description: "IT Consulting & Technical Support Services", category: "IT & SaaS Services", gstRateBps: 1800, defaultUom: "OTH" },
  { code: "998314", kind: "SAC", description: "IT Design, Software Development & Cloud SaaS Subscriptions", category: "IT & SaaS Services", gstRateBps: 1800, defaultUom: "OTH" },
  { code: "998361", kind: "SAC", description: "Digital Marketing, Advertising & Campaign Management", category: "Marketing & Ads", gstRateBps: 1800, defaultUom: "OTH" },
  { code: "9987", kind: "SAC", description: "AMC, Machinery Repair, Installation & Maintenance", category: "Maintenance Services", gstRateBps: 1800, defaultUom: "OTH" },
];

export function searchHsnSacCatalog(query: string, limit = 15): HsnSacCatalogEntry[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) {
    return INDIA_HSN_SAC_CATALOG.slice(0, limit);
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ entry: HsnSacCatalogEntry; score: number }> = [];

  for (const entry of INDIA_HSN_SAC_CATALOG) {
    const codeLower = entry.code.toLowerCase();
    const descLower = entry.description.toLowerCase();
    const catLower = entry.category.toLowerCase();
    let score = 0;

    if (codeLower === q) score += 100;
    else if (codeLower.startsWith(q)) score += 60;
    else if (codeLower.includes(q)) score += 30;

    for (const tok of tokens) {
      if (codeLower.startsWith(tok)) score += 25;
      if (descLower.includes(tok)) score += 15;
      if (catLower.includes(tok)) score += 8;
    }

    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.entry.code.localeCompare(b.entry.code))
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map((s) => s.entry);
}

/* ============================================================================
 * 3. Razorpay Open IFSC Directory Lookup (`https://ifsc.razorpay.com/{IFSC}`)
 * ============================================================================ */

export interface IfscLookupResult {
  ok: boolean;
  ifsc: string;
  bank: string;
  branch: string;
  address: string;
  city: string;
  district: string;
  state: string;
  gstStateCode: string | null;
  upi: boolean;
  rtgs: boolean;
  neft: boolean;
  imps: boolean;
  error?: string;
}

const ifscCache = new Map<string, { expiresAt: number; data: IfscLookupResult }>();

export async function lookupIndianIfsc(rawIfsc: string): Promise<IfscLookupResult> {
  const ifsc = (rawIfsc || "").trim().toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
    return {
      ok: false,
      ifsc,
      bank: "",
      branch: "",
      address: "",
      city: "",
      district: "",
      state: "",
      gstStateCode: null,
      upi: false,
      rtgs: false,
      neft: false,
      imps: false,
      error: "IFSC must be 11 characters (4 bank letters + '0' + 6 branch characters, e.g. HDFC0000001).",
    };
  }

  const cached = ifscCache.get(ifsc);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const resp = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (resp.status === 404) {
      return {
        ok: false,
        ifsc,
        bank: "",
        branch: "",
        address: "",
        city: "",
        district: "",
        state: "",
        gstStateCode: null,
        upi: false,
        rtgs: false,
        neft: false,
        imps: false,
        error: `IFSC '${ifsc}' was not found in RBI / Razorpay Open IFSC directory.`,
      };
    }

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const json = (await resp.json()) as Record<string, unknown>;
    const state = typeof json.STATE === "string" ? json.STATE.trim() : "";
    const result: IfscLookupResult = {
      ok: true,
      ifsc,
      bank: typeof json.BANK === "string" ? json.BANK.trim() : "",
      branch: typeof json.BRANCH === "string" ? json.BRANCH.trim() : "",
      address: typeof json.ADDRESS === "string" ? json.ADDRESS.trim() : "",
      city: typeof json.CITY === "string" ? json.CITY.trim() : "",
      district: typeof json.DISTRICT === "string" ? json.DISTRICT.trim() : "",
      state,
      gstStateCode: resolveGstStateCodeFromName(state),
      upi: Boolean(json.UPI),
      rtgs: Boolean(json.RTGS),
      neft: Boolean(json.NEFT),
      imps: Boolean(json.IMPS),
    };
    ifscCache.set(ifsc, { expiresAt: Date.now() + 24 * 3600_000, data: result });
    return result;
  } catch (err) {
    return {
      ok: false,
      ifsc,
      bank: "",
      branch: "",
      address: "",
      city: "",
      district: "",
      state: "",
      gstStateCode: null,
      upi: false,
      rtgs: false,
      neft: false,
      imps: false,
      error: `IFSC lookup temporarily unreachable (${err instanceof Error ? err.message : "network error"}).`,
    };
  }
}

/* ============================================================================
 * 4. India Post PIN Code -> City, District & 2-Digit GST State Code Lookup
 * ============================================================================ */

/**
 * Offline India Postal Circle 2-digit prefix fallback -> 2-digit GST State Code
 * so GST state detection works instantaneously even when offline!
 */
function inferGstStateFromPostalPrefix(pin: string): { stateCode: string; stateName: string } | null {
  const p2 = Number(pin.slice(0, 2));
  const p3 = Number(pin.slice(0, 3));
  if (p2 === 11) return { stateCode: "07", stateName: "Delhi" };
  if (p2 === 12 || p2 === 13) return { stateCode: "06", stateName: "Haryana" };
  if (p2 === 14 || p2 === 15 || p2 === 16) {
    if (p3 === 160) return { stateCode: "04", stateName: "Chandigarh" };
    return { stateCode: "03", stateName: "Punjab" };
  }
  if (p2 === 17) return { stateCode: "02", stateName: "Himachal Pradesh" };
  if (p2 === 18 || p2 === 19) {
    if (p3 === 194) return { stateCode: "38", stateName: "Ladakh" };
    return { stateCode: "01", stateName: "Jammu & Kashmir" };
  }
  if (p2 >= 20 && p2 <= 28) {
    if (p3 >= 244 && p3 <= 249) return { stateCode: "05", stateName: "Uttarakhand" };
    if (p3 === 263) return { stateCode: "05", stateName: "Uttarakhand" };
    return { stateCode: "09", stateName: "Uttar Pradesh" };
  }
  if (p2 >= 30 && p2 <= 34) return { stateCode: "08", stateName: "Rajasthan" };
  if (p2 >= 36 && p2 <= 39) {
    if (p3 === 396) return { stateCode: "26", stateName: "Dadra & Nagar Haveli and Daman & Diu" };
    return { stateCode: "24", stateName: "Gujarat" };
  }
  if (p2 >= 40 && p2 <= 44) {
    if (p3 === 403) return { stateCode: "30", stateName: "Goa" };
    return { stateCode: "27", stateName: "Maharashtra" };
  }
  if (p2 >= 45 && p2 <= 48) return { stateCode: "23", stateName: "Madhya Pradesh" };
  if (p2 === 49) return { stateCode: "22", stateName: "Chhattisgarh" };
  if (p2 === 50) return { stateCode: "36", stateName: "Telangana" };
  if (p2 >= 51 && p2 <= 53) return { stateCode: "37", stateName: "Andhra Pradesh" };
  if (p2 >= 56 && p2 <= 59) return { stateCode: "29", stateName: "Karnataka" };
  if (p2 >= 60 && p2 <= 64) {
    if (p3 === 605) return { stateCode: "34", stateName: "Puducherry" };
    return { stateCode: "33", stateName: "Tamil Nadu" };
  }
  if (p2 >= 67 && p2 <= 69) {
    if (p3 === 682 && pin.startsWith("68255")) return { stateCode: "31", stateName: "Lakshadweep" };
    return { stateCode: "32", stateName: "Kerala" };
  }
  if (p2 >= 70 && p2 <= 74) {
    if (p3 === 737) return { stateCode: "11", stateName: "Sikkim" };
    if (p3 === 744) return { stateCode: "35", stateName: "Andaman & Nicobar Islands" };
    return { stateCode: "19", stateName: "West Bengal" };
  }
  if (p2 >= 75 && p2 <= 77) return { stateCode: "21", stateName: "Odisha" };
  if (p2 === 78) return { stateCode: "18", stateName: "Assam" };
  if (p2 === 79) {
    if (p3 === 790 || p3 === 791 || p3 === 792) return { stateCode: "12", stateName: "Arunachal Pradesh" };
    if (p3 === 793 || p3 === 794) return { stateCode: "17", stateName: "Meghalaya" };
    if (p3 === 795) return { stateCode: "14", stateName: "Manipur" };
    if (p3 === 796) return { stateCode: "15", stateName: "Mizoram" };
    if (p3 === 797 || p3 === 798) return { stateCode: "13", stateName: "Nagaland" };
    return { stateCode: "16", stateName: "Tripura" };
  }
  if (p2 >= 80 && p2 <= 85) {
    if (p3 === 814 || p3 === 815 || p3 === 816 || (p2 >= 82 && p2 <= 83)) {
      return { stateCode: "20", stateName: "Jharkhand" };
    }
    return { stateCode: "10", stateName: "Bihar" };
  }
  return null;
}

export interface PincodeLookupResult {
  ok: boolean;
  pincode: string;
  city: string;
  district: string;
  stateName: string;
  gstStateCode: string | null;
  postOffices: string[];
  source: "india_post_api" | "postal_zone_offline" | "invalid";
  error?: string;
}

const pincodeCache = new Map<string, { expiresAt: number; data: PincodeLookupResult }>();

export async function lookupIndianPincode(rawPin: string): Promise<PincodeLookupResult> {
  const pincode = (rawPin || "").trim();
  if (!/^[1-9][0-9]{5}$/.test(pincode)) {
    return {
      ok: false,
      pincode,
      city: "",
      district: "",
      stateName: "",
      gstStateCode: null,
      postOffices: [],
      source: "invalid",
      error: "Indian PIN code must be 6 digits (100000–999999).",
    };
  }

  const cached = pincodeCache.get(pincode);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const offlineFallback = inferGstStateFromPostalPrefix(pincode);

  try {
    const resp = await fetch(`https://api.postalpincode.in/pincode/${encodeURIComponent(pincode)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4500),
    });
    if (resp.ok) {
      const json = (await resp.json()) as Array<{
        Status?: string;
        PostOffice?: Array<{
          Name?: string;
          Block?: string;
          District?: string;
          State?: string;
        }>;
      }>;
      const firstBatch = Array.isArray(json) ? json[0] : undefined;
      const offices = Array.isArray(firstBatch?.PostOffice) ? firstBatch.PostOffice : [];
      if (firstBatch?.Status === "Success" && offices.length > 0) {
        const primary = offices[0]!;
        const stateName = (primary.State || offlineFallback?.stateName || "").trim();
        const district = (primary.District || "").trim();
        const block = (primary.Block && primary.Block !== "NA" ? primary.Block : district).trim();
        const gstStateCode =
          resolveGstStateCodeFromName(stateName) ?? offlineFallback?.stateCode ?? null;
        const result: PincodeLookupResult = {
          ok: true,
          pincode,
          city: block || district,
          district,
          stateName,
          gstStateCode,
          postOffices: offices
            .map((o) => (o.Name || "").trim())
            .filter(Boolean)
            .slice(0, 8),
          source: "india_post_api",
        };
        pincodeCache.set(pincode, { expiresAt: Date.now() + 24 * 3600_000, data: result });
        return result;
      }
    }
  } catch {
    // Fall through to deterministic postal circle zone mapping
  }

  if (offlineFallback) {
    return {
      ok: true,
      pincode,
      city: "",
      district: "",
      stateName: offlineFallback.stateName,
      gstStateCode: offlineFallback.stateCode,
      postOffices: [],
      source: "postal_zone_offline",
    };
  }

  return {
    ok: false,
    pincode,
    city: "",
    district: "",
    stateName: "",
    gstStateCode: null,
    postOffices: [],
    source: "invalid",
    error: `PIN code '${pincode}' not found.`,
  };
}

/* ============================================================================
 * 5. Frankfurter Open ECB Live Forex API (`https://api.frankfurter.dev/v1/latest`)
 * ============================================================================ */

export interface ForexLookupResult {
  ok: boolean;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  rateMicros: number;
  date: string;
  source: "frankfurter_ecb" | "reference_fallback";
}

const REFERENCE_INR_FALLBACK_RATES: Record<string, number> = {
  USD: 84.5,
  EUR: 91.2,
  GBP: 108.4,
  AED: 23.01,
  SGD: 63.1,
  AUD: 55.4,
  CAD: 61.2,
  JPY: 0.56,
  CHF: 95.8,
  INR: 1,
};

const forexCache = new Map<string, { expiresAt: number; data: ForexLookupResult }>();

export async function lookupLiveForexRate(
  rawFrom: string,
  rawTo = "INR"
): Promise<ForexLookupResult> {
  const from = (rawFrom || "USD").trim().toUpperCase();
  const to = (rawTo || "INR").trim().toUpperCase();
  if (from === to) {
    return {
      ok: true,
      fromCurrency: from,
      toCurrency: to,
      rate: 1,
      rateMicros: 1_000_000,
      date: new Date().toISOString().slice(0, 10),
      source: "frankfurter_ecb",
    };
  }

  const cacheKey = `${from}->${to}`;
  const cached = forexCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const resp = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4500),
      }
    );
    if (resp.ok) {
      const json = (await resp.json()) as {
        date?: string;
        rates?: Record<string, number>;
      };
      const liveRate = json.rates?.[to];
      if (typeof liveRate === "number" && liveRate > 0) {
        const result: ForexLookupResult = {
          ok: true,
          fromCurrency: from,
          toCurrency: to,
          rate: Number(liveRate.toFixed(4)),
          rateMicros: Math.round(liveRate * 1_000_000),
          date: json.date || new Date().toISOString().slice(0, 10),
          source: "frankfurter_ecb",
        };
        forexCache.set(cacheKey, { expiresAt: Date.now() + 3600_000, data: result });
        return result;
      }
    }
  } catch {
    // Fall back to reference table if offline
  }

  // Compute fallback if targeting INR or cross-rate via INR
  const fromInr = REFERENCE_INR_FALLBACK_RATES[from];
  const toInr = REFERENCE_INR_FALLBACK_RATES[to];
  if (fromInr && toInr) {
    const fallbackRate = Number((fromInr / toInr).toFixed(4));
    return {
      ok: true,
      fromCurrency: from,
      toCurrency: to,
      rate: fallbackRate,
      rateMicros: Math.round(fallbackRate * 1_000_000),
      date: new Date().toISOString().slice(0, 10),
      source: "reference_fallback",
    };
  }

  return {
    ok: false,
    fromCurrency: from,
    toCurrency: to,
    rate: 0,
    rateMicros: 0,
    date: new Date().toISOString().slice(0, 10),
    source: "reference_fallback",
  };
}
