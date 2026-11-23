import {
  BaseManagerContext,
  useRemoteJump,
  useRemoteScrollRoot,
  type JumpOutcome,
} from "@/providers";
import { StructuredContentList } from "@/components";
import type { Item, StructuredContent } from "@/models";
import { getNode } from "@/utils";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
} from "react";

import "./NodeContent.scss";

/**
 * How long (ms) a scroll target that was not found is kept after the content has rendered, so that included constituents can still render it.
 * Afterwards it is dropped, so that a section that appears later (e.g. after an edit) does not move the page while the user reads.
 */
const SCROLL_TARGET_TIMEOUT = 3000;

/**
 * How long (ms) the page must stop growing while a found target is still below the top before the scroll ends.
 * The page is then too short to bring the target higher (e.g. a section near the end), and nothing scrolls any more.
 */
const SCROLL_SETTLE = 600;

/**
 * How long (ms) a target may stay pending at all after the content is shown.
 * This ends the scroll even if the page keeps growing or a constituent never receives its item.
 */
const SCROLL_TARGET_MAX = 10000;

/**
 * The keys that scroll the page. Pressing one of them hands scrolling to the user, while any other key (e.g. right Alt for dictation) does not.
 */
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

/**
 * This component renders the content of a node in its own scroll area, and scrolls to a section when it gets a hash (the id of the section's headline).
 * It is the content window of NodeView and the page of OnAsset.
 *
 * Content:
 * The node is an item or a tag inside it: the first part of the nodeID is the key of the item, and getNode finds the node in it.
 * The item comes from the BaseManager, whose subscription delivers the stored item at once (or requests it from the server) and every later update, so the page follows live edits.
 * The item is kept together with its base and key, and the content is derived from it during render, so that after a change of nodeID or base the previous content is never shown (or searched for a target).
 * Until the item is there, the scroll area is empty.
 * The content is rendered by StructuredContentList, which renders constituents (included items) through the same BaseManager, each of them loading on its own.
 *
 * Rendering context:
 * The context passes the depth of the headlines, the function that opens a preview of a referenced node, and the two callbacks of scrolling (handleContentRender, trackLoading).
 * It stays the same object across renders, as all its callbacks are stable, so that the memoized StructuredContentList does not render the document again when only the hash changes.
 *
 * Remote control:
 * The scroll area is registered with the remote control (useRemoteScrollRoot), which reports from it the section that the user reads; the area that shows the node in the address is the main pane.
 * Each jump to a section is reported as well (useRemoteJump, JumpOutcome), so that the remote control learns whether it arrived.
 *
 * Scrolling:
 * A hash can come from any jump to a section: the remote control, a link to a section in a preview, or any other interaction that sets it.
 * Jumping is not a single scroll, as the page is usually not complete yet when the jump starts.
 * Constituents are included one by one, and a constituent renders nothing until its item arrives, so most of a page (e.g. everything included below a heading) may still be missing.
 * A single scroll then stops at the end of the page with the target still further down, and scroll anchoring pins whatever is at the top of the view, such as a section above the target.
 * Anchoring works as intended, but it holds the wrong element: as the constituents load, it keeps that section in view, not the target.
 * So the target stays pending, and every render and every growth of the page scrolls again, until its headline is at the top or the page stops growing (SCROLL_SETTLE).
 * Only then does scroll anchoring take over and keep the target in place while content above it changes.
 * Input that scrolls (wheel, touch, scroll keys, the scrollbar) drops a pending target, so that a jump never pulls the page back from the user.
 *
 * Scroll anchoring itself is on (NodeContent.scss), since constituents keep their components across edits (blockKey in StructuredContentRenderer) and remounted ones start with their cached item.
 * Before that, a block that remounted rendered empty, the page shrank, and the scroll position fell, which anchoring cannot prevent, as the element it anchors to is gone.
 * @param nodeID The node whose content is shown.
 * @param hash The id of the headline to scroll to, if any.
 * @param setHash The function that clears the hash once the scroll has ended.
 * @param nodePreviewFunction The function that opens a preview of a referenced node.
 */
export function NodeContent({
  nodeID,
  hash,
  setHash,
  nodePreviewFunction = undefined,
}: {
  nodeID: string;
  hash?: string;
  setHash?: (hash: string | undefined) => void;
  nodePreviewFunction?: (nodeID: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useRemoteScrollRoot(nodeID, scrollRef);

  // The pending scroll target, the latest setHash, and the latest report live in refs, so that the render callback below stays the same function and the rendering context stays stable.
  const pendingHash = useRef<string | undefined>(undefined);
  const setHashRef = useRef(setHash);
  const report = useRemoteJump(nodeID);
  const reportRef = useRef(report);
  useLayoutEffect(() => {
    setHashRef.current = setHash;
    reportRef.current = report;
  }, [setHash, report]);

  const baseManager = useContext(BaseManagerContext);

  const nodePath = nodeID.split(".");
  const key = nodePath[0];

  // The item is kept with its base and key, and the content is derived for the current nodeID during render.
  // So when the nodeID or the base changes, the previous item's content is never shown (or searched for a scroll target) in its place.
  const [loaded, setLoaded] = useState<{
    base: typeof baseManager;
    key: string;
    item: Item;
  } | null>(null);
  const nodeContent = useMemo<StructuredContent[] | null>(() => {
    if (loaded?.base !== baseManager || loaded.key !== key) return null;
    return getNode(nodeID, loaded.item)?.content ?? null;
  }, [loaded, baseManager, key, nodeID]);
  const contentShown = nodeContent !== null;

  // The settle timer ends a pending target once the page has stopped growing with the target as high as it gets.
  // The number of constituents still waiting for their item (see context.trackLoading) holds the timer back, as they may still grow the page.
  // finish ends the target for good, so that nothing scrolls for it any more, and reports the outcome to the remote control.
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loading = useRef(0);
  const finish = useCallback((outcome: JumpOutcome) => {
    clearTimeout(settle.current);
    settle.current = undefined;
    if (pendingHash.current === undefined) return;
    console.info(`Scroll target ${outcome}:`, pendingHash.current);
    reportRef.current(pendingHash.current, outcome);
    pendingHash.current = undefined;
    setHashRef.current?.(undefined); // Clear the hash, so that a re-render does not scroll again.
  }, []);

  const handleContentRender = useCallback(() => {
    const target = pendingHash.current;
    if (!target) return;

    const container = scrollRef.current;
    const element = container?.querySelector(
      `#${CSS.escape(target)}`
    ) as HTMLElement | null;
    if (!container || !element) return; // The target has not rendered yet, so a later render retries (see SCROLL_TARGET_TIMEOUT).
    // The position of the target relative to the scroller (offsetTop would be relative to .node-content instead).
    const top = () =>
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top;
    if (Math.abs(top()) > 1)
      container.scrollTo({
        top: container.scrollTop + top(),
        behavior: "auto",
      });
    if (Math.abs(top()) <= 1) return finish("reached");
    // The target is still below the top, because the content below it has not rendered yet (constituents load one by one) and the scroll stopped at the end of the page.
    // Each later render or growth of the page scrolls again (see below).
    // Once the page has stopped growing for SCROLL_SETTLE, the target is as high as it gets, and scroll anchoring keeps it in place from then on.
    // While a constituent still waits for its item, the page may still grow, so the timer waits for it (its arrival calls this again).
    clearTimeout(settle.current);
    if (loading.current > 0) return;
    settle.current = setTimeout(() => finish("settled"), SCROLL_SETTLE);
  }, [finish]);

  const trackLoading = useCallback(
    (delta: number) => {
      loading.current += delta;
      // Another constituent waits (e.g. one nested in an item that just arrived), so the page may grow again and must not settle yet.
      if (delta > 0) clearTimeout(settle.current);
      // The last item arrived (its effect runs after the retry of its render), so the target may settle now.
      else if (loading.current === 0) handleContentRender();
    },
    [handleContentRender]
  );

  // This custom scroll effect is used to ensure that only the contents container scrolls and the nav / etc. remains untouched.
  // A new hash is taken over only when it changes, so that a parent that does not clear the hash (e.g. OnAsset) does not cause repeated scrolling.
  useLayoutEffect(() => {
    // A new target is reported, and so is the pending target that it replaces (not through finish, which would clear the new hash).
    if (hash !== pendingHash.current) {
      if (pendingHash.current !== undefined)
        reportRef.current(pendingHash.current, "replaced");
      if (hash !== undefined) reportRef.current(hash, "started");
    }
    clearTimeout(settle.current);
    pendingHash.current = hash;
    handleContentRender();
  }, [hash, handleContentRender]);

  // If the target was not rendered yet, retry once the content (and, via the context, each constituent) has rendered.
  useLayoutEffect(() => {
    handleContentRender();
  }, [handleContentRender, nodeContent]);

  // When the page grows (a constituent, math, an image) while a target is pending, it scrolls again.
  useEffect(() => {
    const content = scrollRef.current?.firstElementChild;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (pendingHash.current !== undefined) handleContentRender();
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      clearTimeout(settle.current);
    };
  }, [handleContentRender]);

  // Drop a target that was not found within SCROLL_TARGET_TIMEOUT, and any target after SCROLL_TARGET_MAX.
  // Both count from when the content is shown, so that a slow first load (a cold server, a reconnect) does not give the target up before it could scroll at all.
  useEffect(() => {
    if (hash === undefined || !contentShown) return;
    const notFound = setTimeout(() => {
      const target = pendingHash.current;
      if (
        target !== undefined &&
        !scrollRef.current?.querySelector(`#${CSS.escape(target)}`)
      )
        finish("not-found");
    }, SCROLL_TARGET_TIMEOUT);
    const timedOut = setTimeout(() => finish("timed-out"), SCROLL_TARGET_MAX);
    return () => {
      clearTimeout(notFound);
      clearTimeout(timedOut);
    };
  }, [hash, contentShown, finish]);

  // When the user scrolls (wheel, touch, a scroll key, the scrollbar, a middle-click), the pending target is dropped, so that it never pulls the page back.
  // Other input (clicks in the text, other keys) leaves it alone.
  useEffect(() => {
    const off = new AbortController();
    const options = { passive: true, capture: true, signal: off.signal };
    const leave = () => finish("cancelled");
    window.addEventListener("wheel", leave, options);
    window.addEventListener("touchmove", leave, options);
    window.addEventListener(
      "keydown",
      (event) => {
        const editing = (event.target as HTMLElement | null)?.closest?.(
          "input, textarea, [contenteditable]"
        );
        if (SCROLL_KEYS.has(event.key) && !editing) leave();
      },
      options
    );
    window.addEventListener(
      "pointerdown",
      (event) => {
        // The scroller itself is the target of a press on its scrollbar, but also of one in its empty margins beside the text.
        // Only a press within the scrollbar (right of the client area) counts.
        const scroller = scrollRef.current;
        const onScrollbar =
          !!scroller &&
          event.target === scroller &&
          event.offsetX >= scroller.clientWidth;
        if (onScrollbar || event.button === 1) leave();
      },
      options
    );
    return () => off.abort();
  }, [finish]);

  // A stable context lets the memoized StructuredContentList skip re-rendering the document when only the hash changes.
  const context = useMemo(
    () => ({
      depth: 0,
      openReference: nodePreviewFunction,
      handleContentRender: handleContentRender,
      trackLoading: trackLoading,
    }),
    [nodePreviewFunction, handleContentRender, trackLoading]
  );

  useEffect(() => {
    if (!baseManager) return;

    const unsubscribe = baseManager.subscribe(key, (item: Item) =>
      setLoaded({ base: baseManager, key, item })
    );

    // subscribe already delivers the stored item (or requests it from the server), so no separate retrieve is needed.
    return unsubscribe;
  }, [baseManager, key]);

  return (
    <div ref={scrollRef} className="node-content-wrapper">
      <div className="node-content-container">
        <div className="node-content">
          {nodeContent && (
            <StructuredContentList contents={nodeContent} context={context} />
          )}
        </div>
      </div>
    </div>
  );
}
