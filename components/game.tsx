"use client";

import html2canvas from "html2canvas";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildFlavorText } from "@/lib/flavor-text";
import {
  ALL_PREDEFINED_ELEMENTS,
  STARTING_ELEMENTS,
  createPairKey,
  getPredefinedResult
} from "@/lib/predefined-elements";
import type { ElementRecord, RecipeResult, SortMode, WorkbenchItem } from "@/lib/types";

const STORAGE_KEY = "alchemy-lab-state";
const ITEM_SIZE = 78;

type CachedCombination = {
  element: string;
  emoji: string;
  flavorText: string;
};

type DiscoveryState = {
  elements: ElementRecord[];
  cachedCombinations: Record<string, CachedCombination>;
};

type Celebration = {
  firstElement: string;
  secondElement: string;
  element: string;
  emoji: string;
  flavorText: string;
  global: boolean;
};

type ConfirmationState = {
  title: string;
  body: string;
  confirmLabel: string;
  action: "clear-workbench" | "start-over";
};

type ShareDataLike = {
  title?: string;
  text?: string;
  url?: string;
  files?: File[];
};

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

function getInitialState(): DiscoveryState {
  return {
    elements: STARTING_ELEMENTS,
    cachedCombinations: {}
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

export function Game() {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const trashRef = useRef<HTMLButtonElement | null>(null);
  const shareCardRef = useRef<HTMLDivElement | null>(null);
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
  const lastWorkbenchTapRef = useRef<{ id: string; time: number } | null>(null);
  const lastTrashTapRef = useRef<number>(0);
  const [ready, setReady] = useState(false);
  const [elements, setElements] = useState<ElementRecord[]>(STARTING_ELEMENTS);
  const [cachedCombinations, setCachedCombinations] = useState<Record<string, CachedCombination>>({});
  const [workbench, setWorkbench] = useState<WorkbenchItem[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [focusPanel, setFocusPanel] = useState<"split" | "elements" | "workbench">("split");
  const [message, setMessage] = useState<string>("Drag elements together to combine them.");
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [pendingPair, setPendingPair] = useState<string | null>(null);
  const [paletteGhost, setPaletteGhost] = useState<WorkbenchItem | null>(null);
  const [sharedElementCount, setSharedElementCount] = useState<number | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as DiscoveryState;
        if (parsed.elements?.length) {
          setElements(
            parsed.elements.map((entry) => ({
              ...entry,
              flavorText: entry.flavorText ?? buildFlavorText(entry.element)
            }))
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
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setReady(true);
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
      cachedCombinations
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [cachedCombinations, elements, ready]);

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
        addElementToWorkbench(pendingTouch.element);
      }

      const active = dragRef.current;
      if (active) {
        dragRef.current = null;
        const current = workbench.find((item) => item.id === active.id);
        if (current && active.moved) {
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
  }, [paletteGhost, workbench]);

  const sortedElements = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return sortElements(elements, sortMode).filter((entry) =>
      normalizedQuery.length === 0
        ? true
        : entry.element.toLowerCase().includes(normalizedQuery)
    );
  }, [elements, searchQuery, sortMode]);

  const knownRecipePool = ALL_PREDEFINED_ELEMENTS.length + (sharedElementCount ?? 0);

  function addElementToWorkbench(element: ElementRecord) {
    const bounds = boardRef.current?.getBoundingClientRect();
    const x = bounds ? Math.max(16, Math.min(bounds.width - ITEM_SIZE - 16, bounds.width / 2 - ITEM_SIZE / 2 + (Math.random() * 120 - 60))) : 120;
    const y = bounds ? Math.max(16, Math.min(bounds.height - ITEM_SIZE - 16, bounds.height / 2 - ITEM_SIZE / 2 + (Math.random() * 120 - 60))) : 120;

    setWorkbench((current) => [...current, createWorkbenchItem(element.element, element.emoji, x, y)]);
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
    setMessage("Back to the four primal elements.");
    window.localStorage.removeItem(STORAGE_KEY);
    setMobileMenuOpen(false);
  }

  function togglePanelFocus(panel: "elements" | "workbench") {
    setFocusPanel((current) => (current === panel ? "split" : panel));
  }

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    const item = workbench.find((entry) => entry.id === id);
    if (item?.isProcessing) {
      return;
    }

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

  function handleElementTileClick(element: ElementRecord) {
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
      setElements((current) => [
        ...current,
        {
          element: result.element,
          emoji: result.emoji,
          flavorText: result.flavorText,
          discoveredAt: discoveryTime
        }
      ]);

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
        "Content-Type": "application/json"
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
      setMessage(`Combining ${firstItem.element} + ${secondItem.element}...`);
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
      setWorkbench((current) => [
        ...current.filter((item) => item.id !== processingItem.id),
        createWorkbenchItem(firstItem.element, firstItem.emoji, firstItem.x, firstItem.y),
        createWorkbenchItem(secondItem.element, secondItem.emoji, secondItem.x, secondItem.y)
      ]);
      setMessage(error instanceof Error ? error.message : "That combination failed.");
    }
  }

  return (
    <main className={`page-shell panel-${focusPanel}`}>
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
            <label className="sort-select">
              <span>Sort</span>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="az">A-Z</option>
                <option value="za">Z-A</option>
                <option value="recent">Most recent</option>
                <option value="oldest">Oldest</option>
              </select>
            </label>

            <div className="stats-grid mobile-stats">
              <div className="stat-card">
                <span className="stat-label">Discovered</span>
                <strong>{elements.length}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Known recipe pool</span>
                <strong>{knownRecipePool}</strong>
              </div>
            </div>

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
            <p className="panel-kicker desktop-only">Elements</p>
            <div className="panel-actions">
              <button
                className={`ghost-button panel-toggle ${focusPanel === "elements" ? "active" : ""}`}
                onClick={() => togglePanelFocus("elements")}
                type="button"
                aria-label={focusPanel === "elements" ? "Exit fullscreen" : "Enter fullscreen"}
              >
                ⛶
              </button>
            </div>
          </div>

          <div className="desktop-controls">
            <label className="sort-select">
              <span>Sort</span>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="az">A-Z</option>
                <option value="za">Z-A</option>
                <option value="recent">Most recent</option>
                <option value="oldest">Oldest</option>
              </select>
            </label>
          </div>

          <input
            className="element-search"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search"
            type="search"
            value={searchQuery}
          />

          <p className="panel-note desktop-only">Double-click any element to place it on the workbench.</p>

          <div className="element-list">
            {sortedElements.map((entry) => (
              <div
                key={entry.element}
                className="element-chip"
                title={`${entry.element}: ${entry.flavorText}`}
              >
                <span
                  className="chip-drag-zone"
                  onPointerDown={(event) => {
                    beginPaletteInteraction(event, entry);
                  }}
                  role="button"
                  tabIndex={0}
                  title={`Drag ${entry.element} to the workbench`}
                >
                  <span className="chip-drag-handle">⋮⋮</span>
                  <span className="chip-emoji">{entry.emoji}</span>
                </span>
                <button
                  className="chip-name-button"
                  onClick={() => handleElementTileClick(entry)}
                  type="button"
                  title={`Add ${entry.element} to the workbench`}
                >
                  <span className="chip-name">{entry.element}</span>
                </button>
              </div>
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
                className={`ghost-button panel-toggle ${focusPanel === "workbench" ? "active" : ""}`}
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
            {pendingPair ? <span className="pending-indicator">Checking shared database...</span> : null}
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
                onDoubleClick={() => duplicateWorkbenchItem(item)}
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
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-label">Discovered</span>
                  <strong>{elements.length}</strong>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Known recipe pool</span>
                  <strong>{knownRecipePool}</strong>
                </div>
              </div>
            </div>

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
        <div className="celebration-backdrop" onClick={() => setCelebration(null)} role="presentation">
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
              <button className="ghost-button" onClick={() => setCelebration(null)} type="button">
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
    </main>
  );
}
