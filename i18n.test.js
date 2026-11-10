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
    expect(Object.keys(entry).sort(), key).toEqual([...LANGUAGES].sort());
    for (const lang of LANGUAGES) {
      expect(typeof entry[lang], `${key} ${lang}`).toBe("string");
      expect(entry[lang].trim(), `${key} ${lang}`).not.toBe("");
      expect(placeholders(entry[lang]), `${key} ${lang}`).toEqual(
        placeholders(entry.en),
      );
    }
  });

  // WCAG 2.5.3 Label in Name: a button's accessible name keeps its visible
  // text whole, so "Resolve" stays one phrase in "Resolve <title>".
  it.each([
    ["INSIDER_CAT$OPEN_NAMED", "INSIDER_CAT$OPEN"],
    ["INSIDER_CAT$RESOLVE_NAMED", "INSIDER_CAT$RESOLVE"],
    ["INSIDER_CAT$REOPEN_NAMED", "INSIDER_CAT$REOPEN"],
  ])("keeps the visible label whole in %s", (named, visible) => {
    for (const lang of LANGUAGES)
      expect(translations[named][lang].toLowerCase(), lang).toContain(
        translations[visible][lang].toLowerCase(),
      );
  });
});
