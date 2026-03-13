import { NextResponse } from "next/server";
import { buildFlavorText } from "@/lib/flavor-text";
import {
  ALL_PREDEFINED_ELEMENTS,
  PREDEFINED_RECIPE_BOOK,
  createPairKey,
  getPredefinedResult,
  normalizeElementName
} from "@/lib/predefined-elements";
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
  created_at?: string;
};

type RecipeContextEntry = {
  first: string;
  second: string;
  element: string;
  emoji: string;
  flavorText: string;
  source: "predefined" | "database";
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

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function scoreRecipeContext(first: string, second: string, candidate: { first: string; second: string; element: string }) {
  let score = 0;
  const candidateInputs = [candidate.first, candidate.second];
  const normalizedInputs = [first, second];

  for (const input of normalizedInputs) {
    if (candidateInputs.includes(input)) {
      score += 8;
    }
  }

  const inputTokens = new Set([...tokenize(first), ...tokenize(second)]);
  for (const token of [...tokenize(candidate.first), ...tokenize(candidate.second), ...tokenize(candidate.element)]) {
    if (inputTokens.has(token)) {
      score += 2;
    }
  }

  return score;
}

function collectPredefinedContext(first: string, second: string) {
  return PREDEFINED_RECIPE_BOOK
    .map((entry) => ({
      ...entry,
      score: scoreRecipeContext(first, second, entry)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.element.localeCompare(right.element))
    .slice(0, 8)
    .map(
      (entry) =>
        ({
          first: entry.first,
          second: entry.second,
          element: entry.element,
          emoji: entry.emoji,
          flavorText: buildFlavorText(entry.element),
          source: "predefined"
        }) satisfies RecipeContextEntry
    );
}

async function collectDatabaseContext(
  supabase: ReturnType<typeof getSupabaseClient>,
  first: string,
  second: string
) {
  const related = await supabase
    .from("alchemy_combinations")
    .select("pair_key, first_element, second_element, element, emoji, flavor_text, created_at")
    .or(
      [
        `first_element.eq.${first}`,
        `second_element.eq.${first}`,
        `first_element.eq.${second}`,
        `second_element.eq.${second}`
      ].join(",")
    )
    .limit(16);

  if (related.error || !related.data) {
    return [] as RecipeContextEntry[];
  }

  return (related.data as CombinationRow[])
    .map((entry) => ({
      entry,
      score: scoreRecipeContext(first, second, {
        first: entry.first_element,
        second: entry.second_element,
        element: entry.element
      })
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return (right.entry.created_at ?? "").localeCompare(left.entry.created_at ?? "");
    })
    .slice(0, 6)
    .map(
      ({ entry }) =>
        ({
          first: entry.first_element,
          second: entry.second_element,
          element: entry.element,
          emoji: entry.emoji,
          flavorText: entry.flavor_text ?? buildFlavorText(entry.element),
          source: "database"
        }) satisfies RecipeContextEntry
    );
}

function buildGenerationContext(first: string, second: string, contextEntries: RecipeContextEntry[]) {
  const elementDetails = [first, second]
    .map((name) => {
      const known = ALL_PREDEFINED_ELEMENTS.find((entry) => entry.element === name);
      return {
        element: name,
        emoji: known?.emoji ?? null,
        flavorText: known?.flavorText ?? buildFlavorText(name)
      };
    })
    .map(
      (entry) =>
        `- ${entry.element}${entry.emoji ? ` ${entry.emoji}` : ""}: ${entry.flavorText}`
    )
    .join("\n");

  const neighborhood = contextEntries.length
    ? contextEntries
        .map(
          (entry) =>
            `- ${entry.first} + ${entry.second} -> ${entry.element} ${entry.emoji} (${entry.source})`
        )
        .join("\n")
    : "- No nearby examples found.";

  return {
    elementDetails,
    neighborhood
  };
}

function ensureCohesiveResult(
  generated: { emoji: string; element: string; flavorText: string },
  first: string,
  second: string
) {
  const cleanedElement = cleanElementName(generated.element);

  const conflictsWithInputs =
    cleanedElement.toLowerCase() === first.toLowerCase() ||
    cleanedElement.toLowerCase() === second.toLowerCase();
  const finalElement =
    conflictsWithInputs ? cleanElementName(`${first} ${second} Variant`) : cleanedElement;

  return {
    emoji: getSingleEmoji(generated.emoji),
    element: finalElement,
    flavorText: cleanFlavorText(generated.flavorText, finalElement)
  };
}

async function generateWithOpenAI(
  first: string,
  second: string,
  contextEntries: RecipeContextEntry[]
) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const context = buildGenerationContext(first, second, contextEntries);

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
                "You create playful but logical alchemy element results for an existing recipe ecosystem. Keep new results cohesive with nearby examples, using similar naming style and world logic without copying exact outputs. Prefer concrete, game-friendly nouns over vague abstractions. When you combine items, consider what would happen in the real world, myth, folklore, or a whimsical lab. Do not just mash names together unless that is genuinely the best result. It is acceptable for multiple combinations to lead to the same existing element when that makes sense. Avoid simply returning either input name unchanged as the full output. Return JSON only. The element must feel like a plausible fusion of the two inputs, avoid long singular words because they will be in a constrained environment, and use exactly one emoji grapheme. Include a short witty one-sentence flavor text with a playful, lightly sarcastic narrator tone that is safe for all ages."
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
                input_context: context.elementDetails,
                nearby_examples: context.neighborhood,
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
  return ensureCohesiveResult(parsed, first, second);
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

  const authorizationHeader = request.headers.get("authorization");
  const accessToken = authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!accessToken) {
    return NextResponse.json(
      { error: "Sign in with Google to create brand-new AI combinations." },
      { status: 401 }
    );
  }

  const userLookup = await supabase.auth.getUser(accessToken);
  if (userLookup.error || !userLookup.data.user) {
    return NextResponse.json(
      { error: "Your session expired. Sign in again to create brand-new AI combinations." },
      { status: 401 }
    );
  }

  try {
    const contextEntries = [
      ...collectPredefinedContext(first, second),
      ...(await collectDatabaseContext(supabase, first, second))
    ];
    const generated = await generateWithOpenAI(first, second, contextEntries);

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
      } as never)
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
