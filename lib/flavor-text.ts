const OPENERS = [
  "Excellent,",
  "Marvelous,",
  "Behold,",
  "Naturally,",
  "Impressive,"
];

const ENDINGS = [
  "science remains loosely supervised.",
  "nobody asked for it, yet here we are.",
  "the workbench is getting ideas.",
  "reality seems willing to negotiate.",
  "your lab has become alarmingly confident.",
  "the universe barely objected.",
  "that feels like it should need paperwork."
];

const PATTERNS = [
  "{opener} {element} has entered the chat, apparently without a permit.",
  "{opener} you discovered {element}, which sounds more intentional than it probably was.",
  "{opener} {element} exists now, and somehow that feels like your responsibility.",
  "{opener} {element} just arrived, proving chaos can be surprisingly productive.",
  "{opener} {element} is unlocked, because subtlety left the lab hours ago.",
  "{opener} {element} appeared, and {ending}",
  "{opener} {element} joins the collection, which is definitely a choice.",
  "{opener} {element} is real now, so the experiment is winning on technicality.",
  "{opener} {element} showed up right on cue for maximum dramatic nonsense."
];

const OVERRIDES: Record<string, string> = {
  Earth: "Reliable, sturdy, and still convinced everything should be dirt.",
  Air: "Invisible, dramatic, and somehow always involved in the mess.",
  Water: "Flexible, refreshing, and determined to be everyone else's problem.",
  Fire: "Warm, bright, and famously terrible at staying calm.",
  Lava: "Congratulations, you invented hot rock with anger management issues.",
  Steam: "Water, but now with ambition and absolutely no patience.",
  Mountain: "A giant pile of determination, now inconveniently in the way.",
  Human: "Well done, you made paperwork, opinions, and snack breaks possible.",
  Robot: "Efficient, shiny, and already judging your cable management.",
  Dragon: "Excellent, a flying lizard with confidence and property concerns.",
  Internet: "You discovered the world's loudest library and least supervised argument.",
  Time: "Bold choice; absolutely nobody handles this ingredient responsibly.",
  Motion: "At last, things are happening on purpose, or at least with momentum.",
  Force: "A surprisingly polite word for making the universe shove back.",
  Mass: "Dense, stubborn, and now carrying the conversation by sheer presence.",
  Acceleration: "Everything just got faster, which feels unsafe but scientifically valid.",
  Momentum: "Speed met commitment and now neither of them can stop.",
  Inertia: "A masterclass in continuing exactly as planned, whether helpful or not.",
  Gravity: "The universe has started pulling rank, and everything else noticed.",
  Orbit: "Falling sideways with confidence somehow still counts as elegance.",
  Airplane: "You taught metal to dream of birds, and honestly it overachieved.",
  Pilot: "Congratulations, someone now believes they can park in the sky.",
  Airport: "A monument to schedules, luggage, and collective optimism about boarding.",
  Flight: "All the drama of falling, rebranded as transportation.",
  Shuttle: "A bus, but with fewer stops and much higher consequences.",
  Terminal: "A surprisingly emotional place for snacks, gates, and hasty goodbyes.",
  "Control Tower": "A very tall reminder that chaos prefers supervision.",
  Wing: "Turns out flying works better when the air has something to argue with.",
  Runway: "A long strip of confidence where gravity briefly loses the debate."
};

function hashText(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

export function buildFlavorText(element: string) {
  const normalized = element.trim();
  if (OVERRIDES[normalized]) {
    return OVERRIDES[normalized];
  }

  const hash = hashText(normalized.toLowerCase());
  const opener = OPENERS[hash % OPENERS.length];
  const ending = ENDINGS[hash % ENDINGS.length];
  const pattern = PATTERNS[hash % PATTERNS.length];

  return pattern
    .replace("{opener}", opener)
    .replace("{element}", normalized)
    .replace("{ending}", ending);
}
