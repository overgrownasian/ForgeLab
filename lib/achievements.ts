export type AchievementState = {
  discoveredCount: number;
  worldFirstCount: number;
  revealedRecipeCount: number;
  isSignedIn: boolean;
  hasCustomTheme: boolean;
};

export type AchievementDefinition = {
  id: string;
  title: string;
  emoji: string;
  requirement: string;
  flavorText: string;
  category: "discovery" | "legend" | "lore" | "style" | "identity";
  check: (state: AchievementState) => boolean;
  progress: (state: AchievementState) => {
    value: number;
    target: number;
    label: string;
  };
};

export type AchievementGalleryEntry = AchievementDefinition & {
  unlocked: boolean;
  progressValue: number;
  progressTarget: number;
  progressLabel: string;
};

function createCountAchievement(config: {
  id: string;
  title: string;
  emoji: string;
  requirement: string;
  flavorText: string;
  category: AchievementDefinition["category"];
  target: number;
  metric: keyof Pick<AchievementState, "discoveredCount" | "worldFirstCount" | "revealedRecipeCount">;
}) {
  return {
    id: config.id,
    title: config.title,
    emoji: config.emoji,
    requirement: config.requirement,
    flavorText: config.flavorText,
    category: config.category,
    check: (state: AchievementState) => state[config.metric] >= config.target,
    progress: (state: AchievementState) => {
      const value = Math.min(state[config.metric], config.target);

      return {
        value,
        target: config.target,
        label: `${value}/${config.target}`
      };
    }
  } satisfies AchievementDefinition;
}

export const ACHIEVEMENTS = [
  createCountAchievement({
    id: "discovered-10",
    title: "Pocketful of Wonders",
    emoji: "🎒",
    requirement: "Discover 10 elements",
    flavorText: "Ten elements already. Your imaginary backpack now rattles with suspicious optimism.",
    category: "discovery",
    metric: "discoveredCount",
    target: 10
  }),
  createCountAchievement({
    id: "discovered-25",
    title: "Quartermaster of Curiosities",
    emoji: "🗝️",
    requirement: "Discover 25 elements",
    flavorText: "Twenty-five discoveries. Even the guild clerk had to admit your nonsense looks organized.",
    category: "discovery",
    metric: "discoveredCount",
    target: 25
  }),
  createCountAchievement({
    id: "discovered-50",
    title: "Vault Whisperer",
    emoji: "🏰",
    requirement: "Discover 50 elements",
    flavorText: "Fifty elements. Somewhere, a dragon is nervously checking its inventory spreadsheet.",
    category: "discovery",
    metric: "discoveredCount",
    target: 50
  }),
  createCountAchievement({
    id: "discovered-100",
    title: "Museum of Bad Ideas",
    emoji: "🏛️",
    requirement: "Discover 100 elements",
    flavorText: "One hundred discoveries. Historians will call this brave, or deeply avoidable.",
    category: "discovery",
    metric: "discoveredCount",
    target: 100
  }),
  createCountAchievement({
    id: "world-first-1",
    title: "Name in the Chronicle",
    emoji: "📜",
    requirement: "Claim 1 world-first discovery",
    flavorText: "A world first. The bards are warming up, and yes, they already got your hair wrong.",
    category: "legend",
    metric: "worldFirstCount",
    target: 1
  }),
  createCountAchievement({
    id: "world-first-5",
    title: "Patent Pending Hero",
    emoji: "👑",
    requirement: "Claim 5 world-first discoveries",
    flavorText: "Five world firsts. The universe is starting to suspect you have a loophole.",
    category: "legend",
    metric: "worldFirstCount",
    target: 5
  }),
  createCountAchievement({
    id: "recipe-reveals-5",
    title: "Hallway Snooper",
    emoji: "🕯️",
    requirement: "Reveal 5 hidden recipe clues",
    flavorText: "Five secrets uncovered. The dusty tome would like some privacy, actually.",
    category: "lore",
    metric: "revealedRecipeCount",
    target: 5
  }),
  {
    id: "signed-in",
    title: "Registered Adventurer",
    emoji: "🛡️",
    requirement: "Sign in with Google",
    flavorText: "Officially registered. Bureaucracy has never looked so heroically optional.",
    category: "identity",
    check: (state: AchievementState) => state.isSignedIn,
    progress: (state: AchievementState) => ({
      value: state.isSignedIn ? 1 : 0,
      target: 1,
      label: state.isSignedIn ? "Ready" : "Locked"
    })
  },
  {
    id: "custom-theme",
    title: "Dramatic Cloak Upgrade",
    emoji: "🎭",
    requirement: "Activate any non-default theme",
    flavorText: "You changed the room lighting. Clearly this is what separates amateurs from legends.",
    category: "style",
    check: (state: AchievementState) => state.hasCustomTheme,
    progress: (state: AchievementState) => ({
      value: state.hasCustomTheme ? 1 : 0,
      target: 1,
      label: state.hasCustomTheme ? "Styled" : "Default only"
    })
  }
] satisfies AchievementDefinition[];

export function getNewlyUnlockedAchievementIds(
  state: AchievementState,
  earnedIds: string[]
) {
  const earned = new Set(earnedIds);

  return ACHIEVEMENTS.filter((achievement) => achievement.check(state) && !earned.has(achievement.id)).map(
    (achievement) => achievement.id
  );
}

export function buildAchievementGalleryEntries(
  state: AchievementState,
  earnedIds: string[]
) {
  const unlockedIds = new Set([
    ...earnedIds,
    ...ACHIEVEMENTS.filter((achievement) => achievement.check(state)).map((achievement) => achievement.id)
  ]);

  return [...ACHIEVEMENTS]
    .map((achievement) => {
      const progress = achievement.progress(state);

      return {
        ...achievement,
        unlocked: unlockedIds.has(achievement.id),
        progressValue: progress.value,
        progressTarget: progress.target,
        progressLabel: progress.label
      } satisfies AchievementGalleryEntry;
    })
    .sort((left, right) => {
      if (left.unlocked !== right.unlocked) {
        return left.unlocked ? -1 : 1;
      }

      return left.title.localeCompare(right.title);
    });
}
