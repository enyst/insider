import { describe, expect, it } from "vitest";
import translations from "./src/i18n/translation.json";
import { I18nKey } from "./src/i18n/declaration.js";

const LANGUAGES = [
  "ar", "ca", "de", "en", "es", "fr", "it", "ja",
  "ko-KR", "no", "pt", "tr", "uk", "zh-CN", "zh-TW",
];

const placeholders = (text) =>
  [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe("Insider translations", () => {
  it("declares only keys the catalog has", () => {
    for (const key of Object.values(I18nKey))
      expect(translations, key).toHaveProperty([key]);
  });

  it.each(Object.keys(translations))("translates %s into every language", (key) => {
    const entry = translations[key];
    for (const lang of LANGUAGES) {
      expect(typeof entry[lang], `${key} ${lang}`).toBe("string");
      expect(entry[lang].trim(), `${key} ${lang}`).not.toBe("");
      expect(placeholders(entry[lang]), `${key} ${lang}`).toEqual(
        placeholders(entry.en),
      );
    }
  });
});
