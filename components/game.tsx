"use client";

import html2canvas from "html2canvas";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ACHIEVEMENTS,
  buildAchievementGalleryEntries,
  getNewlyUnlockedAchievementIds
} from "@/lib/achievements";
import { getBrowserSupabaseClient } from "@/lib/browser-supabase";
import { buildFlavorText } from "@/lib/flavor-text";
import {
  ALL_PREDEFINED_ELEMENTS,
  PREDEFINED_RECIPE_BOOK,
  STARTING_ELEMENTS,
  createPairKey,
  getPredefinedResult
} from "@/lib/predefined-elements";
import type { ElementRecord, RecipeResult, SortMode, WorkbenchItem } from "@/lib/types";

const STORAGE_KEY = "alchemy-lab-state";
const THEME_STORAGE_KEY = "alchemy-lab-theme";
const ITEM_SIZE = 78;
const CLOUD_SAVE_DEBOUNCE_MS = 900;

const THEMES = ["default", "fantasy", "sci-fi", "xianxia", "radar", "matrix", "solar"] as const;

type ThemeName = (typeof THEMES)[number];
type BrowserSupabaseClient = ReturnType<typeof getBrowserSupabaseClient>;
type RecipeVisibilityFilter = "all" | "found" | "hidden";

type CachedCombination = {
  element: string;
  emoji: string;
  flavorText: string;
};

type DiscoveryState = {
  elements: ElementRecord[];
  cachedCombinations: Record<string, CachedCombination>;
  achievements?: string[];
  worldFirstDiscoveryCount?: number;
};

type PersistedPlayerState = {
  discoveredElementNames: string[];
  displayName: string;
  theme: ThemeName;
  revealedRecipeResults: string[];
  achievements: string[];
  worldFirstDiscoveryCount: number;
};

type PlayerStateRow = {
  user_id: string;
  discovered_elements: string[] | null;
  display_name: string | null;
  theme: string | null;
  revealed_recipe_results: string[] | null;
  achievements: string[] | null;
  world_first_discovery_count: number | null;
  updated_at?: string;
};

type Celebration = {
  firstElement: string;
  secondElement: string;
  element: string;
  emoji: string;
  flavorText: string;
  global: boolean;
  reopenRecipeBookOnClose?: boolean;
};

type ConfirmationState = {
  title: string;
  body: string;
  confirmLabel: string;
  action: "clear-workbench" | "start-over";
};

type AuthPromptState = {
  title: string;
  body: string;
  actionLabel: string;
};

type AchievementModalState = {
  newlyUnlockedIds: string[];
};

type ShareDataLike = {
  title?: string;
  text?: string;
  url?: string;
  files?: File[];
};

const FORGING_STATUS_LINES = [
  "Getting our mad scientist on...",
  "Stirring the beaker with unnecessary confidence...",
  "Consulting the ancient lab notebook...",
  "Applying highly questionable genius...",
  "Encouraging the atoms to make bad decisions..."
];

function createItemId() {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createWorkbenchItem(element: string, emoji: string, x = 120, y = 120): WorkbenchItem {
  return {
    id: createItemId(),
    element,
    emoji,
    x,
    y
  };
}

function createProcessingItem(x = 120, y = 120): WorkbenchItem {
  return {
    id: createItemId(),
    element: "Forging...",
    emoji: "⏳",
    x,
    y,
    isProcessing: true
  };
}

function sortElements(elements: ElementRecord[], mode: SortMode) {
  return [...elements].sort((left, right) => {
    if (mode === "az") {
      return left.element.localeCompare(right.element);
    }
    if (mode === "za") {
      return right.element.localeCompare(left.element);
    }
    if (mode === "recent") {
      return right.discoveredAt - left.discoveredAt;
    }
    return left.discoveredAt - right.discoveredAt;
  });
}

function normalizeElements(elements: ElementRecord[]) {
  const uniqueByName = new Map<string, ElementRecord>();

  for (const entry of elements) {
    const key = entry.element.trim().toLowerCase();
    const existing = uniqueByName.get(key);

    if (!existing || entry.discoveredAt > existing.discoveredAt) {
      uniqueByName.set(key, entry);
    }
  }

  return Array.from(uniqueByName.values());
}

function isThemeName(value: string): value is ThemeName {
  return THEMES.includes(value as ThemeName);
}

function getForgingStatusLine(first: string, second: string) {
  const seed = `${first}:${second}`.split("").reduce((total, character) => total + character.charCodeAt(0), 0);
  return `${first} + ${second}... ${FORGING_STATUS_LINES[seed % FORGING_STATUS_LINES.length]}`;
}

function getSessionFallbackDisplayName(session: Session | null) {
  const metadataName = session?.user.user_metadata.full_name;
  if (typeof metadataName === "string" && metadataName.trim()) {
    return metadataName.trim().slice(0, 32);
  }

  const emailName = session?.user.email?.split("@")[0];
  if (emailName) {
    return emailName.slice(0, 32);
  }

  return "ForgeLab Alchemist";
}

function normalizeDisplayName(value: string, fallback: string) {
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, 32);
  return trimmed || fallback;
}

function buildDiscoveredElementNames(elements: ElementRecord[]) {
  return normalizeElements(elements)
    .sort((left, right) => left.discoveredAt - right.discoveredAt)
    .map((entry) => entry.element);
}

function hydratePredefinedElement(elementName: string, discoveredAt: number): ElementRecord | null {
  const knownElement = ALL_PREDEFINED_ELEMENTS.find((entry) => entry.element === elementName);
  if (!knownElement) {
    return null;
  }

  const recipe = PREDEFINED_RECIPE_BOOK.find((entry) => entry.element === elementName);

  return {
    element: knownElement.element,
    emoji: knownElement.emoji,
    flavorText: knownElement.flavorText,
    discoveredAt,
    isStarter: knownElement.isStarter,
    discoveryFirstElement: recipe?.first,
    discoverySecondElement: recipe?.second
  };
}

function getPlayerStatesTable(client: BrowserSupabaseClient) {
  return client.from("player_states");
}

export function Game() {
  const supabase = useMemo(() => {
    try {
      return getBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const trashRef = useRef<HTMLButtonElement | null>(null);
  const shareCardRef = useRef<HTMLDivElement | null>(null);
  const desktopMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
    pointerType: string;
  } | null>(null);
  const paletteDragRef = useRef<{
    element: string;
    emoji: string;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
    pointerType: string;
  } | null>(null);
  const pendingTouchPaletteRef = useRef<{
    element: ElementRecord;
    pointerId: number;
    startX: number;
    startY: number;
    target: HTMLElement;
  } | null>(null);
  const suppressPaletteClickRef = useRef<{
    element: string;
    until: number;
  } | null>(null);
  const isApplyingCloudStateRef = useRef(false);
  const achievementNotificationsReadyRef = useRef(false);
  const guestProgressRef = useRef<PersistedPlayerState>({
    discoveredElementNames: buildDiscoveredElementNames(STARTING_ELEMENTS),
    displayName: "ForgeLab Alchemist",
    theme: "default",
    revealedRecipeResults: [],
    achievements: [],
    worldFirstDiscoveryCount: 0
  });
  const latestPersistedStateRef = useRef<PersistedPlayerState>({
    discoveredElementNames: buildDiscoveredElementNames(STARTING_ELEMENTS),
    displayName: "ForgeLab Alchemist",
    theme: "default",
    revealedRecipeResults: [],
    achievements: [],
    worldFirstDiscoveryCount: 0
  });
  const lastCloudSnapshotRef = useRef<string | null>(null);
  const lastWorkbenchTapRef = useRef<{ id: string; time: number } | null>(null);
  const lastTrashTapRef = useRef<number>(0);
  const [ready, setReady] = useState(false);
  const [elements, setElements] = useState<ElementRecord[]>(STARTING_ELEMENTS);
  const [cachedCombinations, setCachedCombinations] = useState<Record<string, CachedCombination>>({});
  const [workbench, setWorkbench] = useState<WorkbenchItem[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const [focusPanel, setFocusPanel] = useState<"split" | "elements" | "workbench">("split");
  const [theme, setTheme] = useState<ThemeName>("default");
  const [message, setMessage] = useState<string>("Drag elements together to combine them.");
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [authPrompt, setAuthPrompt] = useState<AuthPromptState | null>(null);
  const [achievementModal, setAchievementModal] = useState<AchievementModalState | null>(null);
  const [pendingPair, setPendingPair] = useState<string | null>(null);
  const [paletteGhost, setPaletteGhost] = useState<WorkbenchItem | null>(null);
  const [sharedElementCount, setSharedElementCount] = useState<number | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<string>("Guest mode on this device.");
  const [displayName, setDisplayName] = useState("ForgeLab Alchemist");
  const [achievements, setAchievements] = useState<string[]>([]);
  const [worldFirstDiscoveryCount, setWorldFirstDiscoveryCount] = useState(0);
  const [recipeBookOpen, setRecipeBookOpen] = useState(false);
  const [achievementGalleryOpen, setAchievementGalleryOpen] = useState(false);
  const [recipeSearchQuery, setRecipeSearchQuery] = useState("");
  const [recipeBookStatus, setRecipeBookStatus] = useState<string | null>(null);
  const [recipeVisibilityFilter, setRecipeVisibilityFilter] = useState<RecipeVisibilityFilter>("all");
  const [recipeStarterFilter, setRecipeStarterFilter] = useState<string>("all");
  const [revealedRecipeResults, setRevealedRecipeResults] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as DiscoveryState;
        if (parsed.elements?.length) {
          setElements(
            normalizeElements(
              parsed.elements.map((entry) => ({
                ...entry,
                flavorText: entry.flavorText ?? buildFlavorText(entry.element)
              }))
            )
          );
        }
        if (parsed.cachedCombinations) {
          setCachedCombinations(
            Object.fromEntries(
              Object.entries(parsed.cachedCombinations).map(([key, value]) => [
                key,
                {
                  ...value,
                  flavorText: value.flavorText ?? buildFlavorText(value.element)
                }
              ])
            )
          );
        }
        if (Array.isArray(parsed.achievements)) {
          setAchievements(parsed.achievements.filter((entry): entry is string => typeof entry === "string"));
        }
        if (typeof parsed.worldFirstDiscoveryCount === "number") {
          setWorldFirstDiscoveryCount(parsed.worldFirstDiscoveryCount);
        }
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme && isThemeName(savedTheme)) {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    async function loadSharedCount() {
      try {
        const response = await fetch("/api/stats");
        const payload = (await response.json()) as { sharedElementCount?: number; error?: string };

        if (!response.ok || typeof payload.sharedElementCount !== "number") {
          return;
        }

        setSharedElementCount(payload.sharedElementCount);
      } catch {
        // Leave the stat empty if the shared count is temporarily unavailable.
      }
    }

    void loadSharedCount();
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }

    const payload: DiscoveryState = {
      elements,
      cachedCombinations,
      achievements,
      worldFirstDiscoveryCount
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [achievements, cachedCombinations, elements, ready, worldFirstDiscoveryCount]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [ready, theme]);

  useEffect(() => {
    latestPersistedStateRef.current = {
      discoveredElementNames: buildDiscoveredElementNames(elements),
      displayName,
      theme,
      revealedRecipeResults,
      achievements,
      worldFirstDiscoveryCount
    };
  }, [achievements, displayName, elements, revealedRecipeResults, theme, worldFirstDiscoveryCount]);

  useEffect(() => {
    if (session?.user) {
      return;
    }

    guestProgressRef.current = latestPersistedStateRef.current;
  }, [session?.user, achievements, displayName, elements, revealedRecipeResults, theme, worldFirstDiscoveryCount]);

  useEffect(() => {
    let active = true;

    if (!supabase) {
      setAuthReady(true);
      setCloudSyncStatus("Sign-in unavailable until Supabase is configured.");
      return;
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) {
        return;
      }

      setSession(data.session ?? null);
      if (data.session?.user) {
        setDisplayName(getSessionFallbackDisplayName(data.session));
      }
      setAuthReady(true);
      if (error) {
        setCloudSyncStatus(error.message);
      } else if (data.session?.user) {
        setCloudSyncStatus("Checking cloud save...");
      }
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        setDisplayName(getSessionFallbackDisplayName(nextSession));
      }
      setAuthReady(true);
      setAuthBusy(false);
      setCloudSyncStatus(
        nextSession?.user ? "Checking cloud save..." : "Guest mode on this device."
      );
      if (!nextSession?.user) {
        setDisplayName("ForgeLab Alchemist");
        setTheme("default");
      }
      lastCloudSnapshotRef.current = null;
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!desktopMenuOpen) {
        return;
      }

      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (desktopMenuRef.current?.contains(target) || desktopMenuButtonRef.current?.contains(target)) {
        return;
      }

      setDesktopMenuOpen(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [desktopMenuOpen]);

  useEffect(() => {
    achievementNotificationsReadyRef.current = false;
  }, [session?.user?.id]);

  useEffect(() => {
    if (!ready || !authReady) {
      return;
    }

    const userId = session?.user.id;
    if (!userId || !supabase) {
      return;
    }

    const client = supabase;
    let cancelled = false;

    async function loadCloudState() {
      setCloudSyncStatus("Syncing cloud save...");

      const { data, error } = await getPlayerStatesTable(client)
        .select("user_id, discovered_elements, display_name, theme, revealed_recipe_results, achievements, world_first_discovery_count, updated_at")
        .eq("user_id", userId as string)
        .maybeSingle();

      if (cancelled) {
        return;
      }

      if (error) {
        setCloudSyncStatus(error.message);
        return;
      }

      const guestProgress = guestProgressRef.current;

      if (!data) {
        try {
          const currentState = {
            ...guestProgress,
            displayName: normalizeDisplayName(guestProgress.displayName, getSessionFallbackDisplayName(session))
          };
          const snapshot = JSON.stringify({
            discoveredElementNames: currentState.discoveredElementNames,
            displayName: currentState.displayName,
            theme: currentState.theme,
            revealedRecipeResults: currentState.revealedRecipeResults,
            achievements: currentState.achievements,
            worldFirstDiscoveryCount: currentState.worldFirstDiscoveryCount
          });

          await getPlayerStatesTable(client).upsert({
            user_id: userId,
            discovered_elements: currentState.discoveredElementNames,
            display_name: currentState.displayName,
            theme: currentState.theme,
            revealed_recipe_results: currentState.revealedRecipeResults,
            achievements: currentState.achievements,
            world_first_discovery_count: currentState.worldFirstDiscoveryCount,
            updated_at: new Date().toISOString()
          } as never);

          if (!cancelled) {
            lastCloudSnapshotRef.current = snapshot;
            setCloudSyncStatus("Cloud save created.");
            setMessage("Signed in. Progress will now sync across devices.");
          }
        } catch {
          if (!cancelled) {
            setCloudSyncStatus("Cloud save unavailable.");
          }
        }

        return;
      }

      const row = data as PlayerStateRow;
      const cloudDiscoveredNames = Array.isArray(row.discovered_elements)
        ? row.discovered_elements.filter((entry): entry is string => typeof entry === "string")
        : buildDiscoveredElementNames(STARTING_ELEMENTS);
      const cloudTheme = row.theme && isThemeName(row.theme) ? row.theme : latestPersistedStateRef.current.theme;
      const cloudRevealedRecipeResults = Array.isArray(row.revealed_recipe_results)
        ? row.revealed_recipe_results.filter((entry): entry is string => typeof entry === "string")
        : [];
      const cloudAchievements = Array.isArray(row.achievements)
        ? row.achievements.filter((entry): entry is string => typeof entry === "string")
        : [];
      const cloudDisplayName = normalizeDisplayName(
        row.display_name ?? "",
        getSessionFallbackDisplayName(session)
      );
      const cloudWorldFirstDiscoveryCount =
        typeof row.world_first_discovery_count === "number" ? row.world_first_discovery_count : 0;
      const mergedDiscoveredNames = Array.from(
        new Set([
          ...buildDiscoveredElementNames(STARTING_ELEMENTS),
          ...cloudDiscoveredNames,
          ...guestProgress.discoveredElementNames
        ])
      );
      const mergedRevealedRecipeResults = Array.from(
        new Set([...cloudRevealedRecipeResults, ...guestProgress.revealedRecipeResults])
      );
      const mergedAchievements = Array.from(new Set([...cloudAchievements, ...guestProgress.achievements]));
      const mergedWorldFirstDiscoveryCount =
        cloudWorldFirstDiscoveryCount + guestProgress.worldFirstDiscoveryCount;
      const uniqueDiscoveredNames = Array.from(
        new Set(mergedDiscoveredNames)
      );
      const predefinedElements = uniqueDiscoveredNames
        .map((elementName, index) => hydratePredefinedElement(elementName, index + 1))
        .filter((entry): entry is ElementRecord => entry !== null);
      const missingNames = uniqueDiscoveredNames.filter(
        (elementName) => !predefinedElements.some((entry) => entry.element === elementName)
      );
      const combinationRows = missingNames.length
        ? (
            await client
              .from("alchemy_combinations")
              .select("first_element, second_element, element, emoji, flavor_text")
              .in("element", missingNames as never)
          ).data ?? []
        : [];
      const combinationMap = new Map(
        (combinationRows as Array<{
          first_element: string;
          second_element: string;
          element: string;
          emoji: string;
          flavor_text: string | null;
        }>).map((entry) => [
          entry.element,
          {
            emoji: entry.emoji,
            flavorText: entry.flavor_text ?? buildFlavorText(entry.element),
            discoveryFirstElement: entry.first_element,
            discoverySecondElement: entry.second_element
          }
        ])
      );
      const cloudElements = normalizeElements(
        uniqueDiscoveredNames.flatMap((elementName, index) => {
          const predefinedElement = predefinedElements.find((entry) => entry.element === elementName);
          if (predefinedElement) {
            return [
              {
                ...predefinedElement,
                discoveredAt: index + 1
              }
            ];
          }

          const generatedElement = combinationMap.get(elementName);
          if (!generatedElement) {
            return [];
          }

          return [
            {
              element: elementName,
              emoji: generatedElement.emoji,
              flavorText: generatedElement.flavorText,
              discoveredAt: index + 1,
              discoveryFirstElement: generatedElement.discoveryFirstElement,
              discoverySecondElement: generatedElement.discoverySecondElement
            } satisfies ElementRecord
          ];
        })
      );

      isApplyingCloudStateRef.current = true;
      setElements(cloudElements);
      setTheme(cloudTheme);
      setRevealedRecipeResults(mergedRevealedRecipeResults);
      setAchievements(mergedAchievements);
      setDisplayName(cloudDisplayName);
      setWorldFirstDiscoveryCount(mergedWorldFirstDiscoveryCount);
      latestPersistedStateRef.current = {
        discoveredElementNames: uniqueDiscoveredNames,
        displayName: cloudDisplayName,
        theme: cloudTheme,
        revealedRecipeResults: mergedRevealedRecipeResults,
        achievements: mergedAchievements,
        worldFirstDiscoveryCount: mergedWorldFirstDiscoveryCount
      };
      const mergedSnapshot = JSON.stringify(latestPersistedStateRef.current);

      const cloudSnapshot = JSON.stringify({
        discoveredElementNames: Array.from(new Set([...buildDiscoveredElementNames(STARTING_ELEMENTS), ...cloudDiscoveredNames])),
        displayName: cloudDisplayName,
        theme: cloudTheme,
        revealedRecipeResults: cloudRevealedRecipeResults,
        achievements: cloudAchievements,
        worldFirstDiscoveryCount: cloudWorldFirstDiscoveryCount
      });

      if (mergedSnapshot !== cloudSnapshot) {
        const { error: mergeError } = await getPlayerStatesTable(client).upsert({
          user_id: userId,
          discovered_elements: uniqueDiscoveredNames,
          display_name: cloudDisplayName,
          theme: cloudTheme,
          revealed_recipe_results: mergedRevealedRecipeResults,
          achievements: mergedAchievements,
          world_first_discovery_count: mergedWorldFirstDiscoveryCount,
          updated_at: new Date().toISOString()
        } as never);

        if (mergeError && !cancelled) {
          setCloudSyncStatus(mergeError.message);
          return;
        }
      }

      lastCloudSnapshotRef.current = mergedSnapshot;
      setCloudSyncStatus("Cloud save loaded.");
      setMessage(
        guestProgress.worldFirstDiscoveryCount > 0 ||
          guestProgress.achievements.length > 0 ||
          guestProgress.discoveredElementNames.length > buildDiscoveredElementNames(STARTING_ELEMENTS).length
          ? "Cloud save loaded. Guest progress merged into your account."
          : "Cloud save loaded."
      );

      window.setTimeout(() => {
        isApplyingCloudStateRef.current = false;
      }, 0);
    }

    void loadCloudState();

    return () => {
      cancelled = true;
    };
  }, [authReady, ready, session, session?.user.id, supabase]);

  useEffect(() => {
    if (!ready || !authReady || !session?.user.id || !supabase || isApplyingCloudStateRef.current) {
      return;
    }

    const payload = latestPersistedStateRef.current;
    const snapshot = JSON.stringify(payload);

    if (lastCloudSnapshotRef.current === snapshot) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      const currentPayload = latestPersistedStateRef.current;
      const currentSnapshot = JSON.stringify(currentPayload);

      if (lastCloudSnapshotRef.current === currentSnapshot) {
        return;
      }

      setCloudSyncStatus("Saving to cloud...");

      const { error } = await getPlayerStatesTable(supabase).upsert({
        user_id: session.user.id,
        discovered_elements: currentPayload.discoveredElementNames,
        display_name: currentPayload.displayName,
        theme: currentPayload.theme,
        revealed_recipe_results: currentPayload.revealedRecipeResults,
        achievements: currentPayload.achievements,
        world_first_discovery_count: currentPayload.worldFirstDiscoveryCount,
        updated_at: new Date().toISOString()
      } as never);

      if (error) {
        setCloudSyncStatus(error.message);
        return;
      }

      lastCloudSnapshotRef.current = currentSnapshot;
      setCloudSyncStatus("Cloud synced.");
    }, CLOUD_SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [authReady, ready, session?.user.id, supabase, elements, cachedCombinations, theme, revealedRecipeResults]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const pendingTouch = pendingTouchPaletteRef.current;
      if (pendingTouch && event.pointerId === pendingTouch.pointerId) {
        const movedX = Math.abs(event.clientX - pendingTouch.startX);
        const movedY = Math.abs(event.clientY - pendingTouch.startY);

        if (movedX > 6 || movedY > 6) {
          beginPaletteDragFromTouch(
            event,
            pendingTouch.element,
            pendingTouch.target,
            pendingTouch.startX,
            pendingTouch.startY
          );
          pendingTouchPaletteRef.current = null;
        }
      }

      const active = dragRef.current;
      const bounds = boardRef.current?.getBoundingClientRect();
      if (active && bounds) {
        if (
          !active.moved &&
          (Math.abs(event.clientX - active.startX) > 6 || Math.abs(event.clientY - active.startY) > 6)
        ) {
          active.moved = true;
        }

        const x = Math.max(0, Math.min(bounds.width - ITEM_SIZE, event.clientX - bounds.left - active.offsetX));
        const y = Math.max(0, Math.min(bounds.height - ITEM_SIZE, event.clientY - bounds.top - active.offsetY));

        setWorkbench((current) =>
          current.map((item) => (item.id === active.id ? { ...item, x, y } : item))
        );
      }

      const paletteActive = paletteDragRef.current;
      if (paletteActive && bounds) {
        if (
          !paletteActive.moved &&
          (Math.abs(event.clientX - paletteActive.startX) > 6 ||
            Math.abs(event.clientY - paletteActive.startY) > 6)
        ) {
          paletteActive.moved = true;
        }

        const x = event.clientX - bounds.left - paletteActive.offsetX;
        const y = event.clientY - bounds.top - paletteActive.offsetY;

        setPaletteGhost(
          createWorkbenchItem(
            paletteActive.element,
            paletteActive.emoji,
            x,
            y
          )
        );
      }
    }

    function onPointerUp(event: PointerEvent) {
      const pendingTouch = pendingTouchPaletteRef.current;
      if (pendingTouch && pendingTouch.pointerId === event.pointerId) {
        pendingTouchPaletteRef.current = null;
        suppressPaletteClickRef.current = {
          element: pendingTouch.element.element,
          until: Date.now() + 400
        };
        addElementToWorkbench(pendingTouch.element);
      }

      const active = dragRef.current;
      if (active) {
        dragRef.current = null;
        const current = workbench.find((item) => item.id === active.id);
        if (current && active.moved) {
          if (current.isProcessing) {
            return;
          }

          const trashBounds = trashRef.current?.getBoundingClientRect();
          if (
            trashBounds &&
            current.x + ITEM_SIZE / 2 + (boardRef.current?.getBoundingClientRect().left ?? 0) >= trashBounds.left &&
            current.x + ITEM_SIZE / 2 + (boardRef.current?.getBoundingClientRect().left ?? 0) <= trashBounds.right &&
            current.y + ITEM_SIZE / 2 + (boardRef.current?.getBoundingClientRect().top ?? 0) >= trashBounds.top &&
            current.y + ITEM_SIZE / 2 + (boardRef.current?.getBoundingClientRect().top ?? 0) <= trashBounds.bottom
          ) {
            setWorkbench((items) => items.filter((item) => item.id !== current.id));
            setMessage(`${current.element} tossed into the void.`);
            return;
          }

          const target = workbench.find((item) => {
            if (item.id === current.id) {
              return false;
            }

            if (item.isProcessing) {
              return false;
            }

            const overlapX = Math.abs(item.x - current.x) < ITEM_SIZE * 0.6;
            const overlapY = Math.abs(item.y - current.y) < ITEM_SIZE * 0.6;
            return overlapX && overlapY;
          });

          if (target) {
            void combineItems(current, target);
          }
        } else if (current && active.pointerType !== "mouse") {
          const now = Date.now();
          const lastTap = lastWorkbenchTapRef.current;

          if (lastTap && lastTap.id === current.id && now - lastTap.time < 320) {
            duplicateWorkbenchItem(current);
            lastWorkbenchTapRef.current = null;
          } else {
            lastWorkbenchTapRef.current = { id: current.id, time: now };
          }
        }
      }

      const paletteActive = paletteDragRef.current;
      const ghost = paletteGhost;
      const bounds = boardRef.current?.getBoundingClientRect();
      if (paletteActive && ghost && bounds) {
        const withinBounds =
          ghost.x + ITEM_SIZE * 0.4 >= 0 &&
          ghost.y + ITEM_SIZE * 0.4 >= 0 &&
          ghost.x <= bounds.width - ITEM_SIZE * 0.4 &&
          ghost.y <= bounds.height - ITEM_SIZE * 0.4;

        if (paletteActive.moved && withinBounds) {
          const dropX = Math.max(0, Math.min(bounds.width - ITEM_SIZE, ghost.x));
          const dropY = Math.max(0, Math.min(bounds.height - ITEM_SIZE, ghost.y));
          const target = workbench.find((item) => {
            const overlapX = Math.abs(item.x - dropX) < ITEM_SIZE * 0.6;
            const overlapY = Math.abs(item.y - dropY) < ITEM_SIZE * 0.6;
            return overlapX && overlapY;
          });

          if (target) {
            void combineItems(
              createWorkbenchItem(paletteActive.element, paletteActive.emoji, dropX, dropY),
              target
            );
          } else {
            setWorkbench((current) => [
              ...current,
              createWorkbenchItem(paletteActive.element, paletteActive.emoji, dropX, dropY)
            ]);
            setMessage(`${paletteActive.element} added to the workbench.`);
          }
        } else if (!paletteActive.moved && paletteActive.pointerType !== "mouse") {
          const tappedElement = elements.find((entry) => entry.element === paletteActive.element);

          if (tappedElement) {
            suppressPaletteClickRef.current = {
              element: tappedElement.element,
              until: Date.now() + 400
            };
            addElementToWorkbench(tappedElement);
          }
        }
      }

      paletteDragRef.current = null;
      setPaletteGhost(null);
    }

    function onPointerCancel() {
      pendingTouchPaletteRef.current = null;
      paletteDragRef.current = null;
      dragRef.current = null;
      setPaletteGhost(null);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  // This listener intentionally tracks the live drag state rather than every helper function dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteGhost, workbench, elements]);

  const sortedElements = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return sortElements(elements, sortMode).filter((entry) =>
      normalizedQuery.length === 0
        ? true
        : entry.element.toLowerCase().includes(normalizedQuery)
    );
  }, [elements, searchQuery, sortMode]);

  const discoveredElements = useMemo(
    () => new Set(elements.map((entry) => entry.element)),
    [elements]
  );

  const filteredRecipeBook = useMemo(() => {
    const normalizedQuery = recipeSearchQuery.trim().toLowerCase();

    return PREDEFINED_RECIPE_BOOK.filter((entry) => {
      const matchesQuery =
        normalizedQuery.length === 0
          ? true
          : entry.first.toLowerCase().includes(normalizedQuery) ||
            entry.second.toLowerCase().includes(normalizedQuery) ||
            entry.element.toLowerCase().includes(normalizedQuery);

      const isFound = discoveredElements.has(entry.element);
      const matchesVisibility =
        recipeVisibilityFilter === "all" ||
        (recipeVisibilityFilter === "found" && isFound) ||
        (recipeVisibilityFilter === "hidden" && !isFound);

      const matchesStarter =
        recipeStarterFilter === "all" ||
        entry.first === recipeStarterFilter ||
        entry.second === recipeStarterFilter;

      return matchesQuery && matchesVisibility && matchesStarter;
    });
  }, [discoveredElements, recipeSearchQuery, recipeStarterFilter, recipeVisibilityFilter]);

  const achievementState = useMemo(
    () => ({
      discoveredCount: elements.length,
      worldFirstCount: worldFirstDiscoveryCount,
      revealedRecipeCount: revealedRecipeResults.length,
      isSignedIn: Boolean(session?.user),
      hasCustomTheme: theme !== "default"
    }),
    [elements.length, revealedRecipeResults.length, session?.user, theme, worldFirstDiscoveryCount]
  );

  const newlyUnlockedAchievementIds = useMemo(
    () => getNewlyUnlockedAchievementIds(achievementState, achievements),
    [achievementState, achievements]
  );

  const achievementGalleryEntries = useMemo(
    () => buildAchievementGalleryEntries(achievementState, achievements),
    [achievementState, achievements]
  );
  const unlockedAchievementEntries = useMemo(
    () => achievementGalleryEntries.filter((entry) => entry.unlocked),
    [achievementGalleryEntries]
  );

  const knownRecipePool = ALL_PREDEFINED_ELEMENTS.length + (sharedElementCount ?? 0);
  const unlockedAchievementCount = unlockedAchievementEntries.length;

  useEffect(() => {
    if (newlyUnlockedAchievementIds.length === 0) {
      return;
    }

    setAchievements((current) => Array.from(new Set([...current, ...newlyUnlockedAchievementIds])));
    if (!achievementNotificationsReadyRef.current) {
      return;
    }

    setAchievementModal((current) => ({
      newlyUnlockedIds: Array.from(new Set([...(current?.newlyUnlockedIds ?? []), ...newlyUnlockedAchievementIds]))
    }));

    const firstAchievement = ACHIEVEMENTS.find((achievement) => achievement.id === newlyUnlockedAchievementIds[0]);
    setMessage(
      firstAchievement
        ? `Achievement unlocked: ${firstAchievement.title}.`
        : `${newlyUnlockedAchievementIds.length} achievement${
            newlyUnlockedAchievementIds.length === 1 ? "" : "s"
          } unlocked.`
    );
  }, [newlyUnlockedAchievementIds]);

  useEffect(() => {
    if (!ready || !authReady) {
      return;
    }

    if (session?.user && cloudSyncStatus === "Checking cloud save...") {
      return;
    }

    const timeout = window.setTimeout(() => {
      achievementNotificationsReadyRef.current = true;
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [authReady, cloudSyncStatus, ready, session?.user]);

  function addElementToWorkbench(element: ElementRecord) {
    const bounds = boardRef.current?.getBoundingClientRect();
    const x = bounds ? Math.max(16, Math.min(bounds.width - ITEM_SIZE - 16, bounds.width / 2 - ITEM_SIZE / 2 + (Math.random() * 120 - 60))) : 120;
    const y = bounds ? Math.max(16, Math.min(bounds.height - ITEM_SIZE - 16, bounds.height / 2 - ITEM_SIZE / 2 + (Math.random() * 120 - 60))) : 120;

    setWorkbench((current) => [...current, createWorkbenchItem(element.element, element.emoji, x, y)]);
  }

  function addDiscoveredElementByName(elementName: string, source: "recipe-result" | "recipe-ingredient") {
    const discoveredElement =
      elements.find((entry) => entry.element === elementName) ??
      ALL_PREDEFINED_ELEMENTS.find((entry) => entry.element === elementName);

    if (!discoveredElement) {
      return;
    }

    addElementToWorkbench(discoveredElement);
    const nextMessage =
      source === "recipe-result"
        ? `${discoveredElement.element} added to the workbench from the recipe result.`
        : `${discoveredElement.element} added to the workbench from the recipe ingredients.`;
    setRecipeBookStatus(nextMessage);
    setMessage(nextMessage);
  }

  function clearWorkbench() {
    setConfirmation({
      title: "Clear workbench?",
      body: "Everything on the board will vanish, including that suspiciously promising combo.",
      confirmLabel: "Clear it",
      action: "clear-workbench"
    });
  }

  function startOver() {
    setConfirmation({
      title: "Start over?",
      body: "Your discoveries will reset to the original four elements, as if the lab learned nothing.",
      confirmLabel: "Reset lab",
      action: "start-over"
    });
  }

  function runConfirmedAction(action: ConfirmationState["action"]) {
    if (action === "clear-workbench") {
      setWorkbench([]);
      setMessage("Workbench cleared.");
      setMobileMenuOpen(false);
      return;
    }

    setElements(STARTING_ELEMENTS);
    setCachedCombinations({});
    setWorkbench([]);
    setCelebration(null);
    setPendingPair(null);
    setSortMode("recent");
    setSearchQuery("");
    setRevealedRecipeResults([]);
    setMessage("Back to the four primal elements.");
    window.localStorage.removeItem(STORAGE_KEY);
    setMobileMenuOpen(false);
  }

  function togglePanelFocus(panel: "elements" | "workbench") {
    setFocusPanel((current) => (current === panel ? "split" : panel));
  }

  function requireSignedIn(feature: "recipe-book" | "themes" | "ai-combos" | "achievements") {
    if (session?.user) {
      return true;
    }

    const prompt =
      feature === "recipe-book"
        ? {
            title: "Unlock the recipe book",
            body: "Sign in with Google to browse recipes, replay discoveries, and carry your progress across devices.",
            actionLabel: "Sign in to open it"
          }
        : feature === "achievements"
          ? {
              title: "Unlock the achievement gallery",
              body: "Sign in with Google to collect achievements, admire your trophy wall, and keep those hard-earned bragging rights.",
              actionLabel: "Sign in to claim it"
            }
        : feature === "themes"
          ? {
              title: "Unlock custom themes",
              body: "Sign in with Google to switch beyond the default theme and keep your lab style synced everywhere.",
              actionLabel: "Sign in to customize"
            }
          : {
              title: "Unlock new AI discoveries",
              body: "Sign in with Google before forging brand-new AI combinations so your world-firsts and progress can be saved.",
              actionLabel: "Sign in to discover"
            };

    setAuthPrompt(prompt);
    return false;
  }

  async function signInWithGoogle() {
    if (!supabase) {
      setCloudSyncStatus("Supabase auth is not configured yet.");
      return;
    }

    setAuthBusy(true);
    setCloudSyncStatus("Redirecting to Google...");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin
      }
    });

    if (error) {
      setAuthBusy(false);
      setCloudSyncStatus(error.message);
    }
  }

  async function signOut() {
    if (!supabase) {
      setCloudSyncStatus("Supabase auth is not configured yet.");
      return;
    }

    setAuthBusy(true);
    const { error } = await supabase.auth.signOut({ scope: "local" });

    if (error) {
      setAuthBusy(false);
      setCloudSyncStatus(error.message);
      return;
    }

    setTheme("default");
    setWorldFirstDiscoveryCount(0);
    setAchievementGalleryOpen(false);
    setAchievementModal(null);
    setCloudSyncStatus("Signed out. Guest mode on this device.");
  }

  function handleThemeChange(nextTheme: ThemeName) {
    if (nextTheme !== "default" && !requireSignedIn("themes")) {
      return;
    }

    setTheme(nextTheme);
    setMessage(`${nextTheme.charAt(0).toUpperCase()}${nextTheme.slice(1)} theme activated.`);
  }

  function openRecipeBook() {
    if (!requireSignedIn("recipe-book")) {
      return;
    }

    setDesktopMenuOpen(false);
    setMobileMenuOpen(false);
    setRecipeBookStatus(null);
    setRecipeBookOpen(true);
  }

  function openAchievementGallery() {
    if (!requireSignedIn("achievements")) {
      return;
    }

    setDesktopMenuOpen(false);
    setMobileMenuOpen(false);
    setAchievementGalleryOpen(true);
  }

  function revealRecipeResult(elementName: string) {
    setRevealedRecipeResults((current) => (current.includes(elementName) ? current : [...current, elementName]));
    setRecipeBookStatus(`${elementName} revealed in the recipe book.`);
  }

  function replayDiscoveryCard(elementName: string, fallbackFirst: string, fallbackSecond: string) {
    const discoveredElement = elements.find((entry) => entry.element === elementName);
    if (!discoveredElement) {
      return;
    }

    const firstElement = discoveredElement.discoveryFirstElement ?? fallbackFirst;
    const secondElement = discoveredElement.discoverySecondElement ?? fallbackSecond;

    setRecipeBookOpen(false);
    setRecipeBookStatus(null);
    setCelebration({
      firstElement,
      secondElement,
      element: discoveredElement.element,
      emoji: discoveredElement.emoji,
      flavorText: discoveredElement.flavorText,
      global: false,
      reopenRecipeBookOnClose: true
    });
  }

  function dismissCelebration() {
    setCelebration((current) => {
      if (current?.reopenRecipeBookOnClose) {
        setRecipeBookOpen(true);
      }

      return null;
    });
  }

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      id,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      pointerType: event.pointerType
    };
  }

  function beginPaletteDrag(
    event: React.PointerEvent<HTMLElement>,
    element: ElementRecord
  ) {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    paletteDragRef.current = {
      element: element.element,
      emoji: element.emoji,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      pointerType: event.pointerType
    };
    setPaletteGhost(
      createWorkbenchItem(
        element.element,
        element.emoji,
        -9999,
        -9999
      )
    );
  }

  function beginPaletteDragFromTouch(
    event: PointerEvent,
    element: ElementRecord,
    target: HTMLElement,
    startX: number,
    startY: number
  ) {
    const bounds = target.getBoundingClientRect();
    target.setPointerCapture?.(event.pointerId);
    paletteDragRef.current = {
      element: element.element,
      emoji: element.emoji,
      offsetX: startX - bounds.left,
      offsetY: startY - bounds.top,
      startX,
      startY,
      moved: true,
      pointerType: event.pointerType
    };

    const boardBounds = boardRef.current?.getBoundingClientRect();
    if (boardBounds) {
      setPaletteGhost(
        createWorkbenchItem(
          element.element,
          element.emoji,
          event.clientX - boardBounds.left - (startX - bounds.left),
          event.clientY - boardBounds.top - (startY - bounds.top)
        )
      );
    }
  }

  function beginPaletteInteraction(event: React.PointerEvent<HTMLElement>, element: ElementRecord) {
    event.preventDefault();

    if (event.pointerType === "touch") {
      pendingTouchPaletteRef.current = {
        element,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        target: event.currentTarget
      };
      return;
    }

    beginPaletteDrag(event, element);
  }

  function handleElementTileDoubleClick(element: ElementRecord) {
    const suppressed = suppressPaletteClickRef.current;
    if (suppressed && suppressed.element === element.element && suppressed.until > Date.now()) {
      suppressPaletteClickRef.current = null;
      return;
    }

    addElementToWorkbench(element);
  }

  function handleTrashTap() {
    const now = Date.now();
    if (now - lastTrashTapRef.current < 320) {
      clearWorkbench();
      lastTrashTapRef.current = 0;
      return;
    }

    lastTrashTapRef.current = now;
  }

  function duplicateWorkbenchItem(item: WorkbenchItem) {
    if (item.isProcessing) {
      return;
    }

    const bounds = boardRef.current?.getBoundingClientRect();
    const maxX = bounds ? bounds.width - ITEM_SIZE : item.x + 24;
    const maxY = bounds ? bounds.height - ITEM_SIZE : item.y + 24;
    const x = Math.max(0, Math.min(maxX, item.x + 28));
    const y = Math.max(0, Math.min(maxY, item.y + 28));

    setWorkbench((current) => [...current, createWorkbenchItem(item.element, item.emoji, x, y)]);
    setMessage(`${item.element} duplicated on the workbench.`);
  }

  async function shareDiscovery() {
    if (!celebration || !shareCardRef.current || isSharing) {
      return;
    }

    try {
      setIsSharing(true);
      setShareStatus(null);

      const canvas = await html2canvas(shareCardRef.current, {
        backgroundColor: null,
        scale: Math.min(window.devicePixelRatio || 2, 3),
        useCORS: true
      });

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((value) => resolve(value), "image/png");
      });

      if (!blob) {
        throw new Error("Could not create share image.");
      }

      const file = new File([blob], `${celebration.element.toLowerCase().replace(/\s+/g, "-")}-discovery.png`, {
        type: "image/png"
      });

      const sharePayload: ShareDataLike = {
        title: "ForgeLab Discovery",
        text: `${celebration.firstElement} + ${celebration.secondElement} -> ${celebration.element}\n${celebration.flavorText}`,
        url: window.location.origin,
        files: [file]
      };

      const textOnlyPayload: ShareDataLike = {
        title: sharePayload.title,
        text: sharePayload.text,
        url: sharePayload.url
      };

      const navigatorWithShare = navigator as Navigator & {
        share?: (data?: ShareDataLike) => Promise<void>;
        canShare?: (data?: ShareDataLike) => boolean;
      };

      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      if (
        navigatorWithShare.share &&
        (!navigatorWithShare.canShare || navigatorWithShare.canShare(sharePayload))
      ) {
        await navigatorWithShare.share(sharePayload);
        setShareStatus("Shared.");
        return;
      }

      if (navigatorWithShare.share && isMobile) {
        try {
          await navigatorWithShare.share(textOnlyPayload);
          setShareStatus("Shared.");
          return;
        } catch {
          // Fall through to clipboard/download if the share sheet is unavailable or cancelled.
        }
      }

      if (navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": blob
          })
        ]);
        setShareStatus("Image copied to clipboard.");
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
      setShareStatus("Image downloaded.");
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : "Share failed.");
    } finally {
      setIsSharing(false);
    }
  }

  function registerDiscovery(result: RecipeResult, inputs: { first: string; second: string }) {
    const alreadyKnown = elements.some((entry) => entry.element === result.element);
    const discoveryTime = Date.now();

    if (!alreadyKnown) {
      setElements((current) =>
        normalizeElements([
          ...current,
          {
            element: result.element,
            emoji: result.emoji,
            flavorText: result.flavorText,
            discoveredAt: discoveryTime,
            discoveryFirstElement: inputs.first,
            discoverySecondElement: inputs.second
          }
        ])
      );

      setCelebration({
        firstElement: inputs.first,
        secondElement: inputs.second,
        element: result.element,
        emoji: result.emoji,
        flavorText: result.flavorText,
        global: Boolean(result.isNewDiscovery)
      });

      if (result.isNewDiscovery) {
        setSharedElementCount((current) => (typeof current === "number" ? current + 1 : current));
        setWorldFirstDiscoveryCount((current) => current + 1);
      }

      setShareStatus(null);
    }

    return !alreadyKnown;
  }

  async function resolveCombination(first: string, second: string) {
    const predefined = getPredefinedResult(first, second);
    if (predefined) {
      return predefined;
    }

    const key = createPairKey(first, second);
    const cached = cachedCombinations[key];
    if (cached) {
      return {
        ...cached,
        source: "database"
      } satisfies RecipeResult;
    }

    setPendingPair(key);

    const response = await fetch("/api/combine", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
      },
      body: JSON.stringify({ first, second })
    });

    const payload = (await response.json()) as RecipeResult | { error: string };
    setPendingPair(null);

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Unknown combination failure.");
      }

    setCachedCombinations((current) => ({
      ...current,
      [key]: {
        element: payload.element,
        emoji: payload.emoji,
        flavorText: payload.flavorText
      }
    }));

    return payload;
  }

  async function combineItems(firstItem: WorkbenchItem, secondItem: WorkbenchItem) {
    if (firstItem.isProcessing || secondItem.isProcessing) {
      return;
    }

    const key = createPairKey(firstItem.element, secondItem.element);
    if (pendingPair === key) {
      return;
    }

    const resultX = (firstItem.x + secondItem.x) / 2;
    const resultY = (firstItem.y + secondItem.y) / 2;
    const processingItem = createProcessingItem(resultX, resultY);

    setWorkbench((current) => [
      ...current.filter((item) => item.id !== firstItem.id && item.id !== secondItem.id),
      processingItem
    ]);

    try {
      setMessage(getForgingStatusLine(firstItem.element, secondItem.element));
      const result = await resolveCombination(firstItem.element, secondItem.element);
      const isPlayerNew = registerDiscovery(result, {
        first: firstItem.element,
        second: secondItem.element
      });

      setWorkbench((current) => {
        return [
          ...current.filter((item) => item.id !== processingItem.id),
          createWorkbenchItem(
            result.element,
            result.emoji,
            resultX,
            resultY
          )
        ];
      });

      setMessage(
        isPlayerNew
          ? `New element discovered: ${result.element}!`
          : `${firstItem.element} + ${secondItem.element} = ${result.element}`
      );
    } catch (error) {
      if (error instanceof Error && /sign in with google|session expired/i.test(error.message)) {
        requireSignedIn("ai-combos");
      }
      setWorkbench((current) => [
        ...current.filter((item) => item.id !== processingItem.id),
        createWorkbenchItem(firstItem.element, firstItem.emoji, firstItem.x, firstItem.y),
        createWorkbenchItem(secondItem.element, secondItem.emoji, secondItem.x, secondItem.y)
      ]);
      setMessage(error instanceof Error ? error.message : "That combination failed.");
    }
  }

  return (
    <main className={`page-shell panel-${focusPanel} theme-${theme}`}>
      <div
        className={`mobile-menu ${mobileMenuOpen ? "open" : ""}`}
        onClick={() => setMobileMenuOpen(false)}
        role="presentation"
      >
        <div className="mobile-menu-card" onClick={(event) => event.stopPropagation()}>
          <div className="mobile-menu-header">
            <button
              className="ghost-button mobile-only panel-toggle mobile-menu-close"
              onClick={() => setMobileMenuOpen(false)}
              type="button"
              aria-label="Close menu"
            >
              ✖
            </button>
            <button className="mobile-menu-title" onClick={() => setMobileMenuOpen(false)} type="button">
              <p className="panel-kicker">Controls</p>
              <h2>Lab menu</h2>
            </button>
          </div>

          <div className="mobile-menu-grid">
            <div className="auth-panel">
              <div className="auth-panel-copy">
                <p className="celebration-label">Cloud save</p>
                <strong>{session?.user ? displayName : "Google sign-in"}</strong>
                <span>
                  {session?.user
                    ? "Your discoveries sync across devices when you are signed in."
                    : "Sign in with Google to carry your discoveries across devices."}
                </span>
              </div>
              {session?.user ? (
                <label className="profile-field">
                  <span>Display name</span>
                  <input
                    onBlur={() => setDisplayName((current) => normalizeDisplayName(current, getSessionFallbackDisplayName(session)))}
                    onChange={(event) => setDisplayName(event.target.value.slice(0, 32))}
                    placeholder="Display name"
                    type="text"
                    value={displayName}
                  />
                </label>
              ) : null}
              <span className="auth-sync-status">{cloudSyncStatus}</span>
              <button
                className={session?.user ? "ghost-button" : "primary-button"}
                onClick={() => void (session?.user ? signOut() : signInWithGoogle())}
                type="button"
                disabled={authBusy}
              >
                {authBusy ? "Working..." : session?.user ? "Sign out" : "Sign in with Google"}
              </button>
            </div>

            <button className="menu-link-button" onClick={openRecipeBook} type="button">
              Recipe book
            </button>

            <button className="menu-link-button" onClick={openAchievementGallery} type="button">
              Achievement gallery
            </button>

            <label className="sort-select">
              <span>Sort</span>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="az">A-Z</option>
                <option value="za">Z-A</option>
                <option value="recent">Most recent</option>
                <option value="oldest">Oldest</option>
              </select>
            </label>

            <label className="sort-select">
              <span>Theme</span>
              <select value={theme} onChange={(event) => handleThemeChange(event.target.value as ThemeName)}>
                <option value="default">Default</option>
                <option value="fantasy">Fantasy</option>
                <option value="sci-fi">Sci-Fi</option>
                <option value="xianxia">Xianxia</option>
                <option value="radar">Radar</option>
                <option value="matrix">Matrix</option>
                <option value="solar">Solar</option>
              </select>
            </label>

            <div className={`stats-grid mobile-stats ${session?.user ? "" : "guest"}`}>
              <div className="stat-card">
                <span className="stat-label">Known recipe pool</span>
                <strong>{knownRecipePool}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Discovered</span>
                <strong>{elements.length}</strong>
              </div>
              {session?.user ? (
                <div className="stat-card">
                  <span className="stat-label">World&apos;s firsts</span>
                  <strong>{worldFirstDiscoveryCount}</strong>
                </div>
              ) : null}
            </div>

            <p className="menu-summary-copy">
              {unlockedAchievementCount} of {ACHIEVEMENTS.length} achievements unlocked
            </p>

            <div className="mobile-action-grid">
              <button className="ghost-button" onClick={clearWorkbench} type="button">
                Clear workbench
              </button>
              <button className="danger-button" onClick={startOver} type="button">
                Start over
              </button>
              <button className="ghost-button" onClick={() => togglePanelFocus("elements")} type="button">
                {focusPanel === "elements" ? "Exit element fullscreen" : "Element fullscreen"}
              </button>
              <button className="ghost-button" onClick={() => togglePanelFocus("workbench")} type="button">
                {focusPanel === "workbench" ? "Exit workbench fullscreen" : "Workbench fullscreen"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <section className="game-layout">
        <aside className="elements-panel">
          <div className="panel-header">
            <button
              className="ghost-button panel-toggle mobile-only panel-menu-button"
              onClick={() => setMobileMenuOpen(true)}
              type="button"
              aria-label="Open menu"
            >
              ☰
            </button>
            <button
              className="panel-kicker panel-label-button mobile-only"
              onClick={() => setMobileMenuOpen(true)}
              type="button"
            >
              Elements
            </button>
            <div className="panel-title-row">
              <button
                className="ghost-button desktop-menu-button desktop-only"
                onClick={() => setDesktopMenuOpen((current) => !current)}
                ref={desktopMenuButtonRef}
                type="button"
                aria-label="Open desktop menu"
              >
                ☰
              </button>
              <p className="panel-kicker desktop-only">Elements</p>
            </div>
            <div className="panel-actions">
              <button
                className={`ghost-button panel-toggle mobile-only ${focusPanel === "elements" ? "active" : ""}`}
                onClick={() => togglePanelFocus("elements")}
                type="button"
                aria-label={focusPanel === "elements" ? "Exit fullscreen" : "Enter fullscreen"}
              >
                ⛶
              </button>
            </div>
          </div>

          {desktopMenuOpen ? (
            <div className="desktop-menu-panel" ref={desktopMenuRef}>
              <div className="auth-panel">
                <div className="auth-panel-copy">
                  <p className="celebration-label">Cloud save</p>
                  <strong>{session?.user ? displayName : "Google sign-in"}</strong>
                  <span>
                    {session?.user
                      ? "This lab will stay in sync across your devices."
                      : "Sign in with Google to sync your discoveries across devices."}
                  </span>
                </div>
                {session?.user ? (
                  <label className="profile-field">
                    <span>Display name</span>
                    <input
                      onBlur={() => setDisplayName((current) => normalizeDisplayName(current, getSessionFallbackDisplayName(session)))}
                      onChange={(event) => setDisplayName(event.target.value.slice(0, 32))}
                      placeholder="Display name"
                      type="text"
                      value={displayName}
                    />
                  </label>
                ) : null}
                <span className="auth-sync-status">{cloudSyncStatus}</span>
                <button
                  className={session?.user ? "ghost-button" : "primary-button"}
                  onClick={() => void (session?.user ? signOut() : signInWithGoogle())}
                  type="button"
                  disabled={authBusy}
                >
                  {authBusy ? "Working..." : session?.user ? "Sign out" : "Sign in with Google"}
                </button>
              </div>
              <button className="menu-link-button" onClick={openRecipeBook} type="button">
                Recipe book
              </button>
              <button className="menu-link-button" onClick={openAchievementGallery} type="button">
                Achievement gallery
              </button>
              <p className="desktop-menu-note">Theme and sort controls now live in the panel for quicker access.</p>
            </div>
          ) : null}

          <label className="sort-select theme-select panel-desktop-only">
            <span>Theme</span>
            <select value={theme} onChange={(event) => handleThemeChange(event.target.value as ThemeName)}>
              <option value="default">Default</option>
              <option value="fantasy">Fantasy</option>
              <option value="sci-fi">Sci-Fi</option>
              <option value="xianxia">Xianxia</option>
              <option value="radar">Radar</option>
              <option value="matrix">Matrix</option>
              <option value="solar">Solar</option>
            </select>
          </label>

          <input
            className="element-search"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search"
            type="search"
            value={searchQuery}
          />

          <div className="sort-links panel-desktop-only" role="group" aria-label="Sort elements">
            <button
              className={`sort-link ${sortMode === "az" ? "active" : ""}`}
              onClick={() => setSortMode("az")}
              type="button"
            >
              ↑AZ
            </button>
            <button
              className={`sort-link ${sortMode === "za" ? "active" : ""}`}
              onClick={() => setSortMode("za")}
              type="button"
            >
              ↓AZ
            </button>
            <button
              className={`sort-link ${sortMode === "oldest" ? "active" : ""}`}
              onClick={() => setSortMode("oldest")}
              type="button"
            >
              ↑🕒
            </button>
            <button
              className={`sort-link ${sortMode === "recent" ? "active" : ""}`}
              onClick={() => setSortMode("recent")}
              type="button"
            >
              ↓🕒
            </button>
          </div>

          <p className="panel-note desktop-only">Double-click any element to place it on the workbench.</p>

          <div className="element-list">
            {sortedElements.map((entry) => (
              <button
                key={entry.element}
                className="element-chip"
                onDoubleClick={() => handleElementTileDoubleClick(entry)}
                onPointerDown={(event) => {
                  beginPaletteInteraction(event, entry);
                }}
                type="button"
                title={`${entry.element}: ${entry.flavorText}`}
              >
                <span className="chip-drag-zone" aria-hidden="true">
                  <span className="chip-drag-handle">⋮⋮</span>
                  <span className="chip-emoji">{entry.emoji}</span>
                </span>
                <span className="chip-name">{entry.element}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="workbench-shell">
          <div className="workbench-header">
            <button
              className="ghost-button panel-toggle mobile-only panel-menu-button"
              onClick={() => setMobileMenuOpen(true)}
              type="button"
              aria-label="Open menu"
            >
              ☰
            </button>
            <div className="workbench-header-main">
              <button
                className="panel-kicker panel-label-button mobile-only"
                onClick={() => setMobileMenuOpen(true)}
                type="button"
              >
                Workbench
              </button>
              <p className="panel-kicker desktop-only">Workbench</p>
            </div>
            <div className="action-row desktop-only">
              <button className="ghost-button" onClick={clearWorkbench} type="button">
                Clear workbench
              </button>
              <button className="danger-button" onClick={startOver} type="button">
                Start over
              </button>
            </div>
            <div className="panel-actions mobile-inline-actions">
              <button
                className={`ghost-button panel-toggle mobile-only ${focusPanel === "workbench" ? "active" : ""}`}
                onClick={() => togglePanelFocus("workbench")}
                type="button"
                aria-label={focusPanel === "workbench" ? "Exit fullscreen" : "Enter fullscreen"}
              >
                ⛶
              </button>
            </div>
          </div>

          <div className="status-bar">
            <span>{message}</span>
            {pendingPair ? <span className="pending-indicator">The lab is cooking...</span> : null}
          </div>

          <div className="workbench" ref={boardRef}>
            {workbench.length === 0 ? (
              <div className="empty-workbench">
                <p>Tap, double-click, or drag elements in to start combining.</p>
              </div>
            ) : null}

            {workbench.map((item) => (
              <button
                key={item.id}
                className={`workbench-item ${item.isProcessing ? "processing" : ""}`}
                onDoubleClick={item.isProcessing ? undefined : () => duplicateWorkbenchItem(item)}
                onPointerDown={(event) => beginDrag(event, item.id)}
                style={{ left: item.x, top: item.y }}
                type="button"
                title={
                  `${item.element}: ${
                    elements.find((entry) => entry.element === item.element)?.flavorText ?? item.element
                  }`
                }
              >
                <span className="workbench-emoji">{item.emoji}</span>
                <span className="workbench-name">{item.element}</span>
              </button>
            ))}

            {paletteGhost ? (
              <div
                className="workbench-item ghost"
                style={{ left: paletteGhost.x, top: paletteGhost.y }}
              >
                <span className="workbench-emoji">{paletteGhost.emoji}</span>
                <span className="workbench-name">{paletteGhost.element}</span>
              </div>
            ) : null}

            <div className="stats-overlay desktop-only">
              <div className={`stats-grid ${session?.user ? "" : "guest"}`}>
                <div className="stat-card">
                  <span className="stat-label">Known recipe pool</span>
                  <strong>{knownRecipePool}</strong>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Discovered</span>
                  <strong>{elements.length}</strong>
                </div>
                {session?.user ? (
                  <div className="stat-card">
                    <span className="stat-label">World&apos;s firsts</span>
                    <strong>{worldFirstDiscoveryCount}</strong>
                  </div>
                ) : null}
              </div>
            </div>

            {session?.user ? (
              <button className="workbench-recipe-link desktop-only" onClick={openRecipeBook} type="button">
                📖
              </button>
            ) : null}

            <button
              className="trash-zone"
              onClick={() => handleTrashTap()}
              onDoubleClick={clearWorkbench}
              ref={trashRef}
              title="Drop here to remove an item or double tap to clear the workbench"
              type="button"
            >
              🗑️
            </button>
          </div>
        </section>
      </section>

      {celebration ? (
        <div className="celebration-backdrop" onClick={dismissCelebration} role="presentation">
          <div
            className={`celebration-card ${celebration.global ? "global" : ""}`}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="celebration-burst" />
            <div className="celebration-topbar">
              <p className="celebration-label">
                {celebration.global ? "World first discovery" : "New discovery"}
              </p>
            </div>

            <div className={`share-card ${celebration.global ? "global" : ""}`} ref={shareCardRef}>
              <p className="share-brand">ForgeLab</p>
              <p className="share-tagline">Combine anything. Discover everything.</p>
              <div className="share-discovery-label">
                {celebration.global ? "World First Discovery" : "New Discovery"}
              </div>
              <div className="share-recipe">
                <div className="share-part">
                  <span className="share-part-name">{celebration.firstElement}</span>
                </div>
                <div className="share-plus">+</div>
                <div className="share-part">
                  <span className="share-part-name">{celebration.secondElement}</span>
                </div>
              </div>
              <div className="share-arrow">↓</div>
              <div className="share-result">
                <div className="celebration-emoji">{celebration.emoji}</div>
                <h3>{celebration.element}</h3>
              </div>
              <p className="share-flavor">{celebration.flavorText}</p>
            </div>

            {shareStatus ? <p className="share-status">{shareStatus}</p> : null}

            <div className="celebration-actions">
              <button className="primary-button" onClick={() => void shareDiscovery()} type="button">
                {isSharing ? "Preparing..." : "Share"}
              </button>
              <button className="ghost-button" onClick={dismissCelebration} type="button">
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmation ? (
        <div className="confirmation-backdrop" onClick={() => setConfirmation(null)} role="presentation">
          <div className="confirmation-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="celebration-label">Careful now</p>
            <h3 id="confirm-title">{confirmation.title}</h3>
            <p>{confirmation.body}</p>
            <div className="confirmation-actions">
              <button className="ghost-button" onClick={() => setConfirmation(null)} type="button">
                Cancel
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  runConfirmedAction(confirmation.action);
                  setConfirmation(null);
                }}
                type="button"
              >
                {confirmation.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {authPrompt ? (
        <div className="confirmation-backdrop" onClick={() => setAuthPrompt(null)} role="presentation">
          <div
            className="confirmation-card auth-prompt-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-prompt-title"
          >
            <p className="celebration-label">Members only</p>
            <h3 id="auth-prompt-title">{authPrompt.title}</h3>
            <p>{authPrompt.body}</p>
            <div className="confirmation-actions">
              <button className="ghost-button" onClick={() => setAuthPrompt(null)} type="button">
                Maybe later
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  setAuthPrompt(null);
                  void signInWithGoogle();
                }}
                type="button"
                disabled={authBusy}
              >
                {authBusy ? "Working..." : authPrompt.actionLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {achievementModal ? (
        <div className="confirmation-backdrop" onClick={() => setAchievementModal(null)} role="presentation">
          <div
            className="confirmation-card achievement-toast-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="achievement-toast-title"
          >
            <p className="celebration-label">Achievement unlocked</p>
            <h3 id="achievement-toast-title">
              {achievementModal.newlyUnlockedIds.length > 1
                ? `${achievementModal.newlyUnlockedIds.length} fresh trophies`
                : achievementGalleryEntries.find(
                    (entry) => entry.id === achievementModal.newlyUnlockedIds[0]
                  )?.title ?? "New achievement"}
            </h3>
            <div className="achievement-toast-list">
              {achievementModal.newlyUnlockedIds.map((id) => {
                const achievement = achievementGalleryEntries.find((entry) => entry.id === id);
                if (!achievement) {
                  return null;
                }

                return (
                  <div className="achievement-toast-item" key={achievement.id}>
                    <span className="achievement-badge" aria-hidden="true">
                      {achievement.emoji}
                    </span>
                    <div className="achievement-copy">
                      <strong>{achievement.title}</strong>
                      <p>{achievement.flavorText}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="confirmation-actions">
              <button className="ghost-button" onClick={() => setAchievementModal(null)} type="button">
                Keep forging
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  setAchievementModal(null);
                  setAchievementGalleryOpen(true);
                }}
                type="button"
              >
                Open gallery
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {recipeBookOpen ? (
        <div className="recipe-book-backdrop" onClick={() => setRecipeBookOpen(false)} role="presentation">
          <div
            className="recipe-book-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="recipe-book-title"
          >
            <div className="recipe-book-header">
              <div>
                <p className="celebration-label">Reference</p>
                <h3 id="recipe-book-title">Recipe book</h3>
              </div>
              <button className="ghost-button" onClick={() => setRecipeBookOpen(false)} type="button">
                Close
              </button>
            </div>

            <input
              className="recipe-book-search"
              onChange={(event) => setRecipeSearchQuery(event.target.value)}
              placeholder="Search recipes"
              type="search"
              value={recipeSearchQuery}
            />

            <div className="recipe-book-filters">
              <div className="recipe-book-filter-group" role="group" aria-label="Recipe visibility">
                <button
                  className={`recipe-filter-chip ${recipeVisibilityFilter === "all" ? "active" : ""}`}
                  onClick={() => setRecipeVisibilityFilter("all")}
                  type="button"
                >
                  All
                </button>
                <button
                  className={`recipe-filter-chip ${recipeVisibilityFilter === "found" ? "active" : ""}`}
                  onClick={() => setRecipeVisibilityFilter("found")}
                  type="button"
                >
                  Found
                </button>
                <button
                  className={`recipe-filter-chip ${recipeVisibilityFilter === "hidden" ? "active" : ""}`}
                  onClick={() => setRecipeVisibilityFilter("hidden")}
                  type="button"
                >
                  Hidden
                </button>
              </div>

              <label className="recipe-book-starter-filter">
                <span>Starter family</span>
                <select
                  onChange={(event) => setRecipeStarterFilter(event.target.value)}
                  value={recipeStarterFilter}
                >
                  <option value="all">All families</option>
                  {STARTING_ELEMENTS.map((entry) => (
                    <option key={entry.element} value={entry.element}>
                      {entry.element}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {recipeBookStatus ? <p className="recipe-book-status-message">{recipeBookStatus}</p> : null}

            <div className="recipe-book-list">
              {filteredRecipeBook.map((entry) => {
                const isFound = discoveredElements.has(entry.element);
                const canAddFirst = discoveredElements.has(entry.first);
                const canAddSecond = discoveredElements.has(entry.second);
                const isRevealed = isFound || revealedRecipeResults.includes(entry.element);
                const isFirstRevealed = canAddFirst || revealedRecipeResults.includes(entry.first);
                const isSecondRevealed = canAddSecond || revealedRecipeResults.includes(entry.second);

                return (
                  <div className="recipe-book-entry" key={`${entry.first}-${entry.second}-${entry.element}`}>
                    <div className="recipe-book-parts">
                      <button
                        className={`recipe-book-token ${canAddFirst || !isFirstRevealed ? "clickable" : ""}`}
                        onClick={() =>
                          canAddFirst ? addDiscoveredElementByName(entry.first, "recipe-ingredient") : revealRecipeResult(entry.first)
                        }
                        type="button"
                      >
                        {isFirstRevealed ? entry.first : "???"}
                      </button>
                      <span className="recipe-book-plus">+</span>
                      <button
                        className={`recipe-book-token ${canAddSecond || !isSecondRevealed ? "clickable" : ""}`}
                        onClick={() =>
                          canAddSecond
                            ? addDiscoveredElementByName(entry.second, "recipe-ingredient")
                            : revealRecipeResult(entry.second)
                        }
                        type="button"
                      >
                        {isSecondRevealed ? entry.second : "???"}
                      </button>
                    </div>
                    <div className="recipe-book-result">
                      <div className="recipe-book-result-stack">
                        <button
                          className={`recipe-book-token recipe-book-result-token ${
                            isFound || !isRevealed ? "clickable" : ""
                          }`}
                          onClick={() =>
                            isFound ? addDiscoveredElementByName(entry.element, "recipe-result") : revealRecipeResult(entry.element)
                          }
                          type="button"
                        >
                          {isRevealed ? (
                            <>
                              <span>{entry.emoji}</span>
                              <span>{entry.element}</span>
                            </>
                          ) : (
                            <span>???</span>
                          )}
                        </button>

                        {isFound ? (
                          <button
                            className="recipe-book-inline-link"
                            onClick={() => replayDiscoveryCard(entry.element, entry.first, entry.second)}
                            type="button"
                          >
                            Show discovery card
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <span className={`recipe-book-status ${isFound ? "known" : ""}`}>
                      {isFound ? "Found" : "Hidden"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {achievementGalleryOpen ? (
        <div className="recipe-book-backdrop" onClick={() => setAchievementGalleryOpen(false)} role="presentation">
          <div
            className="achievement-gallery-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="achievement-gallery-title"
          >
            <div className="recipe-book-header">
              <div>
                <p className="celebration-label">Hall of glory</p>
                <h3 id="achievement-gallery-title">Achievement gallery</h3>
              </div>
              <button className="ghost-button" onClick={() => setAchievementGalleryOpen(false)} type="button">
                Close
              </button>
            </div>

            <div className="achievement-gallery-summary">
              <div className="stat-card">
                <span className="stat-label">Unlocked</span>
                <strong>
                  {unlockedAchievementCount}/{ACHIEVEMENTS.length}
                </strong>
              </div>
              <p>
                ForgeLab keeps your earned achievements, even if you later reset the lab and pretend none of this
                happened.
              </p>
            </div>

            <div className="achievement-gallery-list">
              {unlockedAchievementEntries.length === 0 ? (
                <div className="achievement-empty-state">
                  <p className="celebration-label">Nothing on the wall yet</p>
                  <h4>Your trophy room is still suspiciously tidy.</h4>
                  <p>Keep experimenting. The gallery only shows achievements once you actually earn them.</p>
                </div>
              ) : null}

              {unlockedAchievementEntries.map((achievement) => (
                <article
                  className="achievement-card unlocked"
                  key={achievement.id}
                >
                  <div className="achievement-card-top">
                    <span className="achievement-badge" aria-hidden="true">
                      {achievement.emoji}
                    </span>
                    <span className="achievement-status unlocked">Unlocked</span>
                  </div>
                  <div className="achievement-copy">
                    <h4>{achievement.title}</h4>
                    <p className="achievement-requirement">{achievement.requirement}</p>
                    <p>{achievement.flavorText}</p>
                  </div>
                  <div className="achievement-progress">
                    <span>{achievement.progressLabel}</span>
                    <div className="achievement-progress-track" aria-hidden="true">
                      <span
                        className="achievement-progress-fill"
                        style={{
                          width:
                            achievement.progressValue === 0
                              ? "0%"
                              : `${Math.max(
                                  8,
                                  Math.round(
                                    (achievement.progressValue / achievement.progressTarget) * 100
                                  )
                                )}%`
                        }}
                      />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
