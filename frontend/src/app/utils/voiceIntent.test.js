import { describe, it, expect } from "vitest";
import { matchVoiceIntent, answerVoiceIntent, VOICE_INTENTS } from "./voiceIntent";

// matchVoiceIntent is pure keyword/regex matching over a plain string — no
// SpeechRecognition or other browser API involved — so it's fully
// unit-testable in Node, unlike the recognition wrapper around it.

describe("matchVoiceIntent", () => {
  it("matches the ITC balance intent for Hindi phrasing", () => {
    const result = matchVoiceIntent("mera ITC kitna bacha hai");
    expect(result.intent).toBe(VOICE_INTENTS.ITC_BALANCE);
    expect(result.transcript).toBe("mera ITC kitna bacha hai");
  });

  it("matches the ITC balance intent for English phrasing", () => {
    expect(matchVoiceIntent("how much ITC do I have left").intent).toBe(
      VOICE_INTENTS.ITC_BALANCE
    );
  });

  it("matches the invoice count intent for English phrasing", () => {
    expect(matchVoiceIntent("how many invoices do I have").intent).toBe(
      VOICE_INTENTS.INVOICE_COUNT
    );
  });

  it("matches the invoice count intent for Hinglish (mixed Hindi/English) phrasing", () => {
    expect(matchVoiceIntent("mere kitne invoices hai").intent).toBe(
      VOICE_INTENTS.INVOICE_COUNT
    );
  });

  it("matches the supplier status intent", () => {
    expect(matchVoiceIntent("supplier ka status kaisa hai").intent).toBe(
      VOICE_INTENTS.SUPPLIER_STATUS
    );
  });

  it("prefers supplier status over invoice count when both subjects appear", () => {
    expect(matchVoiceIntent("supplier ke kitne invoice hai, status batao").intent).toBe(
      VOICE_INTENTS.SUPPLIER_STATUS
    );
  });

  it("returns UNKNOWN for random unrelated text", () => {
    expect(matchVoiceIntent("what is the weather today").intent).toBe(
      VOICE_INTENTS.UNKNOWN
    );
  });

  it("returns UNKNOWN for a subject word with no query word", () => {
    expect(matchVoiceIntent("invoice").intent).toBe(VOICE_INTENTS.UNKNOWN);
  });

  it("returns UNKNOWN for an empty string", () => {
    const result = matchVoiceIntent("");
    expect(result.intent).toBe(VOICE_INTENTS.UNKNOWN);
    expect(result.transcript).toBe("");
  });

  it("returns UNKNOWN for whitespace-only input", () => {
    expect(matchVoiceIntent("   ").intent).toBe(VOICE_INTENTS.UNKNOWN);
  });

  it("returns UNKNOWN for non-string input without throwing", () => {
    expect(matchVoiceIntent(undefined).intent).toBe(VOICE_INTENTS.UNKNOWN);
    expect(matchVoiceIntent(null).intent).toBe(VOICE_INTENTS.UNKNOWN);
  });

  it("is case-insensitive", () => {
    expect(matchVoiceIntent("MERA ITC KITNA BACHA HAI").intent).toBe(
      VOICE_INTENTS.ITC_BALANCE
    );
  });

  it("trims surrounding whitespace from the returned transcript", () => {
    const result = matchVoiceIntent("  kitne invoice hai  ");
    expect(result.transcript).toBe("kitne invoice hai");
    expect(result.intent).toBe(VOICE_INTENTS.INVOICE_COUNT);
  });

  describe("Marathi keywords", () => {
    it("matches ITC balance spoken with Marathi phrasing (ITC has no native-word equivalent, said as the acronym)", () => {
      expect(matchVoiceIntent("mera itc kitne bacha hai", "mr").intent).toBe(
        VOICE_INTENTS.ITC_BALANCE
      );
    });

    it("matches invoice count with Marathi keywords", () => {
      expect(matchVoiceIntent("invoice sankhya kitne aahe", "mr").intent).toBe(
        VOICE_INTENTS.INVOICE_COUNT
      );
    });

    it("matches supplier status with Marathi keywords: vikreta, sthiti", () => {
      expect(matchVoiceIntent("vikreta sthiti kaise aahe", "mr").intent).toBe(
        VOICE_INTENTS.SUPPLIER_STATUS
      );
    });

    it("matches supplier status with Marathi keywords: vikreta, kase", () => {
      expect(matchVoiceIntent("vikreta kase ahe", "mr").intent).toBe(
        VOICE_INTENTS.SUPPLIER_STATUS
      );
    });
  });

  describe("Gujarati keywords", () => {
    it("matches ITC balance spoken with Gujarati phrasing (ITC has no native-word equivalent, said as the acronym)", () => {
      expect(matchVoiceIntent("mara itc ketlu baaki che", "gu").intent).toBe(
        VOICE_INTENTS.ITC_BALANCE
      );
    });

    it("matches ITC balance with Gujarati query: shesh", () => {
      expect(matchVoiceIntent("ITC shesh ketlu che", "gu").intent).toBe(
        VOICE_INTENTS.ITC_BALANCE
      );
    });

    it("matches invoice count with Gujarati keywords", () => {
      expect(matchVoiceIntent("invoice ketlu process thayo", "gu").intent).toBe(
        VOICE_INTENTS.INVOICE_COUNT
      );
    });

    it("matches supplier status with Gujarati keywords", () => {
      expect(matchVoiceIntent("supplier kem che", "gu").intent).toBe(
        VOICE_INTENTS.SUPPLIER_STATUS
      );
    });
  });
});

describe("answerVoiceIntent", () => {
  const summary = {
    itc_buckets: { confirmed: 99820, at_risk: 15000 },
    invoices_processed: 583,
    suppliers_monitored: 26,
    issues_open: 3,
  };

  it("answers ITC balance from the already-loaded summary, no new call", () => {
    const answer = answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, summary);
    expect(answer).toContain("₹99,820");
    expect(answer).toContain("₹15,000");
  });

  it("omits the at-risk clause when nothing is at risk", () => {
    const answer = answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, {
      itc_buckets: { confirmed: 5000, at_risk: 0 },
    });
    expect(answer).toContain("₹5,000");
    expect(answer).not.toContain("at-risk");
  });

  it("answers invoice count from the summary", () => {
    expect(answerVoiceIntent(VOICE_INTENTS.INVOICE_COUNT, summary)).toContain("583");
  });

  it("answers supplier status, flagging open issues", () => {
    const answer = answerVoiceIntent(VOICE_INTENTS.SUPPLIER_STATUS, summary);
    expect(answer).toContain("26");
    expect(answer).toContain("3");
  });

  it("reports all-clear when no supplier issues are open", () => {
    const answer = answerVoiceIntent(VOICE_INTENTS.SUPPLIER_STATUS, {
      suppliers_monitored: 10,
      issues_open: 0,
    });
    expect(answer.toLowerCase()).toContain("theek");
  });

  it("gives a helpful fallback for UNKNOWN without throwing", () => {
    expect(() => answerVoiceIntent(VOICE_INTENTS.UNKNOWN, summary)).not.toThrow();
    expect(answerVoiceIntent(VOICE_INTENTS.UNKNOWN, summary).length).toBeGreaterThan(0);
  });

  it("does not throw when summary is missing or incomplete", () => {
    expect(() => answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, undefined)).not.toThrow();
    expect(() => answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, {})).not.toThrow();
  });

  describe("Marathi language support", () => {
    it("returns Marathi phrasing for ITC balance", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, summary, "mr");
      expect(answer).toContain("Aapla confirmed ITC");
      expect(answer).toContain("aahe");
      expect(answer).toContain("₹99,820");
    });

    it("returns Marathi phrasing for invoice count", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.INVOICE_COUNT, summary, "mr");
      expect(answer).toContain("Aaple");
      expect(answer).toContain("583");
      expect(answer).toContain("mahinyat");
    });

    it("returns Marathi phrasing for supplier status with issues", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.SUPPLIER_STATUS, summary, "mr");
      expect(answer).toContain("Aap");
      expect(answer).toContain("26");
      expect(answer).toContain("3");
      expect(answer).toContain("aahe");
    });

    it("returns Marathi phrasing for UNKNOWN intent", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.UNKNOWN, summary, "mr");
      expect(answer).toContain("Samajh");
    });
  });

  describe("Gujarati language support", () => {
    it("returns Gujarati phrasing for ITC balance", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, summary, "gu");
      expect(answer).toContain("Tamara confirmed ITC");
      expect(answer).toContain("che");
      expect(answer).toContain("₹99,820");
    });

    it("returns Gujarati phrasing for invoice count", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.INVOICE_COUNT, summary, "gu");
      expect(answer).toContain("Tamne");
      expect(answer).toContain("583");
      expect(answer).toContain("mahine");
    });

    it("returns Gujarati phrasing for supplier status with issues", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.SUPPLIER_STATUS, summary, "gu");
      expect(answer).toContain("Tame");
      expect(answer).toContain("26");
      expect(answer).toContain("3");
      expect(answer).toContain("problem");
    });

    it("returns Gujarati phrasing for UNKNOWN intent", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.UNKNOWN, summary, "gu");
      expect(answer).toContain("Samjyu");
    });
  });

  describe("English language support", () => {
    it("returns English phrasing for ITC balance", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, summary, "en");
      expect(answer).toContain("Your confirmed ITC");
      expect(answer).toContain("is");
      expect(answer).toContain("₹99,820");
    });

    it("returns English phrasing for invoice count", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.INVOICE_COUNT, summary, "en");
      expect(answer).toContain("You have");
      expect(answer).toContain("583");
      expect(answer).toContain("this month");
    });

    it("returns English phrasing for supplier status with issues", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.SUPPLIER_STATUS, summary, "en");
      expect(answer).toContain("You are monitoring");
      expect(answer).toContain("26");
      expect(answer).toContain("have issues");
    });
  });

  describe("numeric consistency across languages", () => {
    it("preserves exact ITC values across all languages", () => {
      const answerHi = answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, summary, "hi");
      const answerEn = answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, summary, "en");
      const answerMr = answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, summary, "mr");
      const answerGu = answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, summary, "gu");

      expect(answerHi).toContain("₹99,820");
      expect(answerEn).toContain("₹99,820");
      expect(answerMr).toContain("₹99,820");
      expect(answerGu).toContain("₹99,820");

      expect(answerHi).toContain("₹15,000");
      expect(answerEn).toContain("₹15,000");
      expect(answerMr).toContain("₹15,000");
      expect(answerGu).toContain("₹15,000");
    });

    it("preserves exact invoice counts across all languages", () => {
      const answerHi = answerVoiceIntent(VOICE_INTENTS.INVOICE_COUNT, summary, "hi");
      const answerEn = answerVoiceIntent(VOICE_INTENTS.INVOICE_COUNT, summary, "en");
      const answerMr = answerVoiceIntent(VOICE_INTENTS.INVOICE_COUNT, summary, "mr");
      const answerGu = answerVoiceIntent(VOICE_INTENTS.INVOICE_COUNT, summary, "gu");

      expect(answerHi).toContain("583");
      expect(answerEn).toContain("583");
      expect(answerMr).toContain("583");
      expect(answerGu).toContain("583");
    });

    it("preserves exact supplier counts across all languages", () => {
      const answerHi = answerVoiceIntent(VOICE_INTENTS.SUPPLIER_STATUS, summary, "hi");
      const answerEn = answerVoiceIntent(VOICE_INTENTS.SUPPLIER_STATUS, summary, "en");
      const answerMr = answerVoiceIntent(VOICE_INTENTS.SUPPLIER_STATUS, summary, "mr");
      const answerGu = answerVoiceIntent(VOICE_INTENTS.SUPPLIER_STATUS, summary, "gu");

      expect(answerHi).toContain("26");
      expect(answerEn).toContain("26");
      expect(answerMr).toContain("26");
      expect(answerGu).toContain("26");

      expect(answerHi).toContain("3");
      expect(answerEn).toContain("3");
      expect(answerMr).toContain("3");
      expect(answerGu).toContain("3");
    });
  });

  describe("language fallback behavior", () => {
    it("defaults to Hindi when language is not provided", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, summary);
      expect(answer).toContain("Aapka confirmed ITC");
    });

    it("defaults to Hindi when language is unrecognized", () => {
      const answer = answerVoiceIntent(VOICE_INTENTS.ITC_BALANCE, summary, "xx");
      expect(answer).toContain("Aapka confirmed ITC");
    });

    it("defaults to Hindi for unknown intents in all languages", () => {
      const answerEn = answerVoiceIntent(VOICE_INTENTS.UNKNOWN, summary, "en");
      const answerMr = answerVoiceIntent(VOICE_INTENTS.UNKNOWN, summary, "mr");
      const answerGu = answerVoiceIntent(VOICE_INTENTS.UNKNOWN, summary, "gu");

      // All should be different messages, not Hindi defaults
      expect(answerEn).not.toContain("Samajh");
      expect(answerMr).toContain("Samajh");
      expect(answerGu).not.toContain("Samajh");
    });
  });
});
