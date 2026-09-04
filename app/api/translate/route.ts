import { NextResponse } from "next/server";
import {
  readTranslations,
  releaseMonthlyCharacters,
  reserveMonthlyCharacters,
  writeTranslations,
} from "../../../db/translation-cache";

const MAX_ITEMS = 128;
const MAX_CHARACTERS = 10_000;
const MONTHLY_CHARACTER_BUDGET = 400_000;
const TARGET_LANGUAGE = "EN-US";
const CHINESE = /[\u3400-\u9fff]/;

export async function POST(request: Request) {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Translation service is not configured." }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const submitted = typeof body === "object" && body !== null && Array.isArray((body as { texts?: unknown }).texts)
    ? (body as { texts: unknown[] }).texts
    : [];
  const unique = [...new Set(submitted.filter((text): text is string =>
    typeof text === "string" && text.trim().length > 0 && text.length <= 2_000 && CHINESE.test(text),
  ))].slice(0, MAX_ITEMS);
  const characterCount = unique.reduce((sum, text) => sum + text.length, 0);
  if (!unique.length || characterCount > MAX_CHARACTERS) {
    return NextResponse.json({ error: "Translation batch is empty or too large." }, { status: 400 });
  }

  const translatedEntries = await readTranslations(unique, TARGET_LANGUAGE);
  const missing = unique.filter((text) => !translatedEntries.has(text));
  if (!missing.length) {
    return NextResponse.json(
      { translations: Object.fromEntries(translatedEntries) },
      { headers: { "X-Translation-Cache": "HIT" } },
    );
  }

  const missingCharacters = missing.reduce((sum, text) => sum + text.length, 0);
  if (!(await reserveMonthlyCharacters(missingCharacters, MONTHLY_CHARACTER_BUDGET))) {
    return NextResponse.json({ error: "Monthly translation budget reached." }, { status: 429 });
  }

  const apiBaseUrl = apiKey.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  let response: Response | undefined;
  try {
    for (const delay of [0, 750, 1_500, 3_000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      response = await fetch(`${apiBaseUrl}/v2/translate`, {
        method: "POST",
        headers: {
          Authorization: `DeepL-Auth-Key ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: missing, source_lang: "ZH", target_lang: TARGET_LANGUAGE }),
      });
      if (response.status !== 429 && response.status < 500) break;
    }
  } catch (error) {
    await releaseMonthlyCharacters(missingCharacters);
    console.error("DeepL API connection error", error);
    return NextResponse.json({ error: "Translation service is temporarily unavailable." }, { status: 502 });
  }

  if (!response?.ok) {
    await releaseMonthlyCharacters(missingCharacters);
    const detail = response ? await response.text() : "No response";
    console.error("DeepL API error", response?.status, detail.slice(0, 500));
    return NextResponse.json({ error: "Translation service is temporarily unavailable." }, { status: 502 });
  }

  const result = await response.json() as { translations?: Array<{ text?: string }> };
  const translations = result.translations?.map((item) => item.text || "") || [];
  if (translations.length !== missing.length || translations.some((text) => !text)) {
    await releaseMonthlyCharacters(missingCharacters);
    return NextResponse.json({ error: "Incomplete translation response." }, { status: 502 });
  }

  const freshEntries = missing.map((text, index) => [text, translations[index]] as [string, string]);
  await writeTranslations(freshEntries, TARGET_LANGUAGE);
  freshEntries.forEach(([source, translated]) => translatedEntries.set(source, translated));

  return NextResponse.json(
    { translations: Object.fromEntries(unique.map((text) => [text, translatedEntries.get(text) || text])) },
    { headers: { "X-Translation-Cache": "PARTIAL" } },
  );
}
