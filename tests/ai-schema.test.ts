import { describe, expect, it } from "vitest";
import { AiBatchResponseSchema } from "@/lib/ai";

describe("ai schema", () => {
  it("accepts valid payload", () => {
    const payload = {
      evaluations: [
        {
          targetType: "title",
          handle: "sample-handle",
          rowNumber: 2,
          result: "要注意",
          issue: "語順が不自然です。",
          suggestion: "自然な語順に修正してください。",
        },
      ],
    };

    expect(() => AiBatchResponseSchema.parse(payload)).not.toThrow();
  });

  it("rejects invalid result value", () => {
    const payload = {
      evaluations: [
        {
          targetType: "body",
          handle: "sample-handle",
          rowNumber: 3,
          result: "BAD",
          issue: "",
          suggestion: "",
        },
      ],
    };

    expect(() => AiBatchResponseSchema.parse(payload)).toThrow();
  });
});
