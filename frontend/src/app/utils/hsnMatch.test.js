import { describe, expect, it } from "vitest";
import { cosineSimilarity, findBestHSNMatch, matchHSN } from "./hsnMatch.js";

// Small synthetic 3-dim "embeddings" standing in for the real 384-dim
// MiniLM output — enough axes to represent a few distinct semantic
// directions without needing the real model loaded in CI. Each fixture row
// is pre-normalized, matching what the real pipeline produces with
// `{normalize: true}`.
const RICE_ROW = { c: "1006", d: "RICE", r: 5, e: [1, 0, 0] };
const CEMENT_ROW = { c: "2523", d: "PORTLAND CEMENT", r: 28, e: [0, 1, 0] };
const SOAP_ROW = { c: "3401", d: "SOAP", r: 18, e: [0, 0, 1] };
const FIXTURE_ROWS = [RICE_ROW, CEMENT_ROW, SOAP_ROW];

describe("cosineSimilarity", () => {
  it("scores identical vectors as 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("scores orthogonal vectors as 0", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it("scores opposite vectors as -1", () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1);
  });

  it("returns 0 for a zero vector instead of NaN", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0);
  });
});

describe("findBestHSNMatch", () => {
  it("returns the nearest row when it clears the confidence threshold", () => {
    const match = findBestHSNMatch([0.9, 0.1, 0], FIXTURE_ROWS);
    expect(match).toEqual({
      hsn_code: "1006",
      description: "RICE",
      gst_rate: 5,
      confidence: expect.any(Number),
    });
    expect(match.confidence).toBeGreaterThan(0.5);
  });

  it("picks whichever row is actually closest, not just the first", () => {
    const match = findBestHSNMatch([0, 0.2, 0.95], FIXTURE_ROWS);
    expect(match.hsn_code).toBe("3401");
  });

  it("returns null when the best match is below the confidence threshold", () => {
    // Equidistant from all three axes: cosine similarity to each is
    // 1/sqrt(3) ≈ 0.577 — close enough to clear the default 0.5 threshold,
    // so this asserts against a stricter 0.9 threshold instead to prove
    // the gate actually rejects a middling match rather than always
    // passing.
    const match = findBestHSNMatch([0.1, 0.1, 0.1], FIXTURE_ROWS, 0.9);
    expect(match).toBeNull();
  });

  it("respects a custom threshold", () => {
    const queryVec = [0.6, 0.5, 0.5];
    expect(findBestHSNMatch(queryVec, FIXTURE_ROWS, 0.99)).toBeNull();
    expect(findBestHSNMatch(queryVec, FIXTURE_ROWS, 0.5)).not.toBeNull();
  });

  it("returns null for an empty index", () => {
    expect(findBestHSNMatch([1, 0, 0], [])).toBeNull();
  });
});

describe("matchHSN safety fallback", () => {
  it("resolves null for an empty description without touching the model", async () => {
    expect(await matchHSN("")).toBeNull();
    expect(await matchHSN("   ")).toBeNull();
    expect(await matchHSN(undefined)).toBeNull();
  });

  it("resolves null when the browser APIs it needs aren't present (e.g. this Node test env)", async () => {
    // vitest here runs with environment: "node" — no `window` global, which
    // is exactly the "unsupported environment" case matchHSN must no-op on
    // rather than throw.
    expect(await matchHSN("Ultratech Cement 50kg")).toBeNull();
  });
});
