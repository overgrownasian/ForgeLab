export type SortMode = "az" | "za" | "recent" | "oldest";

export type ElementRecord = {
  element: string;
  emoji: string;
  flavorText: string;
  discoveredAt: number;
  isStarter?: boolean;
  discoveryFirstElement?: string;
  discoverySecondElement?: string;
};

export type WorkbenchItem = {
  id: string;
  element: string;
  emoji: string;
  x: number;
  y: number;
  isProcessing?: boolean;
};

export type RecipeResult = {
  element: string;
  emoji: string;
  flavorText: string;
  isNewDiscovery?: boolean;
  source: "predefined" | "database" | "openai";
};

export type CombinationRequest = {
  first: string;
  second: string;
};
