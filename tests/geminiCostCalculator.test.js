// tests/geminiCostCalculator.test.js
//
// Pure unit tests — no DB, no network. calculateGeminiCost() is the only
// thing that turns token counts into a dollar figure anywhere in this
// codebase's new usage-tracking layer (src/ai/geminiCostCalculator.js).

const { calculateGeminiCost } = require("../src/ai/geminiCostCalculator");
const { PRICING_VERSION } = require("../src/ai/geminiPricing");

describe("calculateGeminiCost", () => {
  test("calculates input/output/total cost for a known model at exactly 1M tokens each", () => {
    const result = calculateGeminiCost({
      model: "gemini-live-2.5-flash-native-audio",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(result.inputCost).toBeCloseTo(3.0, 6);
    expect(result.outputCost).toBeCloseTo(12.0, 6);
    expect(result.totalCost).toBeCloseTo(15.0, 6);
  });

  test("stamps currency, pricing version, and an explicit estimated marker", () => {
    const result = calculateGeminiCost({ model: "gemini-live-2.5-flash-native-audio", inputTokens: 100, outputTokens: 100 });
    expect(result.currency).toBe("USD");
    expect(result.pricingVersion).toBe(PRICING_VERSION);
    expect(result.estimated).toBe(true);
  });

  test("handles a small token count with sub-cent precision instead of rounding to zero", () => {
    const result = calculateGeminiCost({ model: "gemini-live-2.5-flash-native-audio", inputTokens: 100, outputTokens: 0 });
    expect(result.inputCost).toBeGreaterThan(0);
    expect(result.inputCost).toBeCloseTo(0.0003, 6);
  });

  test("never throws or goes negative on missing/undefined/negative token counts", () => {
    const result = calculateGeminiCost({ model: "gemini-live-2.5-flash-native-audio", inputTokens: undefined, outputTokens: -50 });
    expect(result.inputCost).toBe(0);
    expect(result.outputCost).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  test("falls back to default pricing for an unrecognized model instead of reporting $0", () => {
    const result = calculateGeminiCost({ model: "some-future-gemini-model-not-in-config", inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(result.inputCost).toBeGreaterThan(0);
    expect(result.outputCost).toBeGreaterThan(0);
  });
});
