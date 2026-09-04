// Builds frontend/public/hsn-index.json — the on-device HSN semantic-match
// index used by the trader PWA's client-side pre-pass (see
// frontend/src/app/utils/hsnMatch.js). This is a build-time script, not
// something that runs in the browser.
//
// Source data: frontend/scripts/hsn-seed.json, a curated ~540-row subset of
// the live `hsn_codes` table (21,934 rows total — far too many to ship to a
// phone). Curated by querying Supabase directly for:
//   1. Every 4-digit HSN heading in chapters 01-24 (food/beverage/tobacco —
//      Raju's Kirana Store's actual product category) plus chapters 25, 33,
//      34, 39, 48, 63, 69, 70, 72, 73, 82, 83, 85, 90, 96 (general-trade
//      goods: cement/sand, soap, plastics, paper, hardware, electricals —
//      the "FMCG, general trade" part of the target persona).
//   2. The exact HSN codes that appear in real `invoice_line_items` history
//      for this project's live data (7214, 7217, 2505, 2523, 6904, 3402,
//      90041000, 19011090), so the curated set is grounded in what traders
//      have actually been invoiced for, not just a theoretical category list.
// See the query history in this feature's commit for the exact SQL. If the
// HSN data changes, re-run that query and overwrite hsn-seed.json, then
// re-run this script.
//
// Embedding model: Xenova/all-MiniLM-L6-v2, NOT the multilingual-e5-small
// this feature was originally specced with — see NPU-1 in
// IQOO_DEVICE_CAPABILITY_SPEC.md for why: every genuinely multilingual
// (Hindi-capable) sentence-embedding model published under the Xenova org
// (multilingual-e5-small, paraphrase-multilingual-MiniLM-L12-v2,
// distiluse-base-multilingual-cased-v2, ...) quantizes to 118-135MB because
// Hindi support requires a ~250k-token XLM-R-style vocabulary — the
// embedding matrix alone dwarfs the "small" transformer body. That's a
// multi-minute download on the patchy connections this product targets, and
// the whole point of this feature is that it silently no-ops rather than
// blocking the upload flow if it doesn't load fast — a model that
// routinely fails to finish loading defeats the feature it's degrading
// gracefully out of. All real line-item text sampled from the live DB
// (invoice OCR output and the official HSN descriptions themselves) is
// Latin-script English/Hinglish, not Devanagari, so English-only coverage
// is not a real regression against the actual data. all-MiniLM-L6-v2
// quantizes to ~23MB, is the same 384-dim output as e5-small, and is the
// most battle-tested model in transformers.js.
//
// Run: node frontend/scripts/build-hsn-index.mjs   (from repo root or
// frontend/ — paths below are relative to this file).

import { pipeline } from "@xenova/transformers";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, "hsn-seed.json");
const OUT_PATH = path.join(__dirname, "..", "public", "hsn-index.json");
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// Rounding embeddings to 5 decimal places keeps cosine-similarity ranking
// effectively identical to full float32 precision while roughly halving the
// JSON size versus unrounded numbers.
function round(x) {
  return Math.round(x * 1e5) / 1e5;
}

async function main() {
  const seed = JSON.parse(readFileSync(SEED_PATH, "utf-8"));
  console.log(`Embedding ${seed.length} HSN descriptions with ${MODEL_ID}...`);

  const embedder = await pipeline("feature-extraction", MODEL_ID, { quantized: true });

  const rows = [];
  for (let i = 0; i < seed.length; i++) {
    const { hsn_code, description, gst_rate } = seed[i];
    const output = await embedder(description, { pooling: "mean", normalize: true });
    rows.push({
      c: hsn_code,
      d: description,
      r: gst_rate,
      e: Array.from(output.data).map(round),
    });
    if ((i + 1) % 50 === 0 || i === seed.length - 1) {
      console.log(`  ${i + 1}/${seed.length}`);
    }
  }

  const index = {
    model: MODEL_ID,
    dim: rows[0].e.length,
    generated_at: new Date().toISOString(),
    rows,
  };

  writeFileSync(OUT_PATH, JSON.stringify(index));
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
