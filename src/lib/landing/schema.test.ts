import { describe, expect, it } from "vitest";
import { validateAnswers, type PublicQuestion } from "./schema";

const postalQuestion: PublicQuestion = {
  field_key: "postnummer",
  label: "Postnummer",
  field_type: "text",
  options: [],
  required: true,
};

describe("postnummer i publika kundformulär", () => {
  it("accepterar svenska postnummer med eller utan mellanrum och avvisar felaktiga", () => {
    expect(validateAnswers([postalQuestion], { postnummer: "50330" }, true)).toEqual({});
    expect(validateAnswers([postalQuestion], { postnummer: "503 30" }, true)).toEqual({});
    expect(validateAnswers([postalQuestion], { postnummer: "5033A" }, true)).toHaveProperty("postnummer");
    expect(validateAnswers([postalQuestion], { postnummer: "503 300" }, true)).toHaveProperty("postnummer");
  });
});
