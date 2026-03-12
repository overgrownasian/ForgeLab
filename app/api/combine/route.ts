import { NextResponse } from "next/server";
import { buildFlavorText } from "@/lib/flavor-text";
import { createPairKey, getPredefinedResult, normalizeElementName } from "@/lib/predefined-elements";
import { getCachedCombination, setCachedCombination } from "@/lib/server-combination-cache";
import { getSupabaseClient } from "@/lib/supabase";
import type { CombinationRequest, RecipeResult } from "@/lib/types";

type CombinationRow = {
  pair_key: string;
  first_element: string;
  second_element: string;
  element: string;
  emoji: string;
  flavor_text: string | null;
};

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

const jsonSchema = {
  name: "alchemy_result",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      emoji: {
        type: "string",
        description: "Exactly one emoji character representing the element."
      },
      element: {
        type: "string",
        description: "A short title-cased element name."
      },
      flavorText: {
        type: "string",
        description: "One short playful sentence, 8 to 16 words, safe for all ages, but a little snarky."
      }
    },
    required: ["emoji", "element", "flavorText"]
  }
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function getSingleEmoji(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "✨";
  }

  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  const graphemes = Array.from(segmenter.segment(trimmed), (entry) => entry.segment);
  const emojiGrapheme = graphemes.find((segment) => /\p{Extended_Pictographic}/u.test(segment));

  return emojiGrapheme ?? "✨";
}

function cleanElementName(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, 36);

  if (!trimmed) {
    return "Mystery";
  }

  return trimmed.replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanFlavorText(value: string, element: string) {
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, 140);
  if (!trimmed) {
    return buildFlavorText(element);
  }

  const sentence = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return sentence;
}

async function generateWithOpenAI(first: string, second: string) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You create playful but logical alchemy element results, Fire+Clay should result in something like 'ceramics' and Steam+Pressure should result in something like 'steam engine, when you combine items consider what would happen in the real world or a lab, don't just combine the two names together unless it makes sense, don't be afraid to create imaginary items as well for existence horn+horse can create unicorn or life+clay can create golem. Return JSON only. The element must feel like a plausible fusion of the two inputs, and avoid using long singular words because they will be in a constrained environment. Use exactly one emoji grapheme. Include a short witty one-sentence flavor text with a playful, lightly sarcastic narrator tone that is safe for all ages, something like, You've discovered fire! The Cavemen would be so proud."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                first,
                second,
                required_format: {
                  emoji: "single emoji only",
                  element: "short title-cased name",
                  flavorText: "one sentence, about 8 to 16 words, playful and witty"
                }
              })
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          ...jsonSchema
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}.`);
  }

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  const rawText =
    payload.output_text ??
    payload.output?.flatMap((entry) => entry.content ?? []).find((entry) => entry.text)?.text;

  if (!rawText) {
    throw new Error("OpenAI returned no text.");
  }

  const parsed = JSON.parse(rawText) as { emoji: string; element: string; flavorText: string };
  const element = cleanElementName(parsed.element);

  return {
    emoji: getSingleEmoji(parsed.emoji),
    element,
    flavorText: cleanFlavorText(parsed.flavorText, element)
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<CombinationRequest>;
  const first = normalizeElementName(body.first ?? "");
  const second = normalizeElementName(body.second ?? "");

  if (!first || !second) {
    return badRequest("Both elements are required.");
  }

  const predefined = getPredefinedResult(first, second);
  if (predefined) {
    return NextResponse.json(predefined);
  }

  const pairKey = createPairKey(first, second);
  const cached = getCachedCombination(pairKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Supabase is not configured." },
      { status: 500 }
    );
  }

  const existing = await supabase
    .from("alchemy_combinations")
    .select("pair_key, first_element, second_element, element, emoji, flavor_text")
    .eq("pair_key", pairKey)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }

  if (existing.data) {
    const row = existing.data as CombinationRow;
    const result = {
      element: row.element,
      emoji: getSingleEmoji(row.emoji),
      flavorText: row.flavor_text ?? buildFlavorText(row.element),
      source: "database"
    } satisfies RecipeResult;

    setCachedCombination(pairKey, result);
    return NextResponse.json(result);
  }

  try {
    const generated = await generateWithOpenAI(first, second);

    const inserted = await supabase
      .from("alchemy_combinations")
      .insert({
        pair_key: pairKey,
        first_element: first,
        second_element: second,
        element: generated.element,
        emoji: generated.emoji,
        flavor_text: generated.flavorText,
        source: "openai",
        model: OPENAI_MODEL
      })
      .select("pair_key, first_element, second_element, element, emoji, flavor_text")
      .maybeSingle();

    if (inserted.error) {
      const raced = await supabase
        .from("alchemy_combinations")
        .select("pair_key, first_element, second_element, element, emoji, flavor_text")
        .eq("pair_key", pairKey)
        .maybeSingle();

      if (raced.data) {
        const row = raced.data as CombinationRow;
        const result = {
          element: row.element,
          emoji: getSingleEmoji(row.emoji),
          flavorText: row.flavor_text ?? buildFlavorText(row.element),
          source: "database"
        } satisfies RecipeResult;

        setCachedCombination(pairKey, result);
        return NextResponse.json(result);
      }

      return NextResponse.json({ error: inserted.error.message }, { status: 500 });
    }

    const row = (inserted.data as CombinationRow | null) ?? null;
    const result = {
      element: row?.element ?? generated.element,
      emoji: getSingleEmoji(row?.emoji ?? generated.emoji),
      flavorText: row?.flavor_text ?? generated.flavorText,
      source: "openai",
      isNewDiscovery: true
    } satisfies RecipeResult;

    setCachedCombination(pairKey, result);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to resolve combination."
      },
      { status: 500 }
    );
  }
}
