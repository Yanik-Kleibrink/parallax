import { BaseManagerContext, useRemoteScrollRoot } from "@/providers";
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

  // The pending scroll target and the latest setHash live in refs, so that the render callback below stays the same function and the rendering context stays stable.
  const pendingHash = useRef<string | undefined>(undefined);
  const setHashRef = useRef(setHash);
  useLayoutEffect(() => {
    setHashRef.current = setHash;
  }, [setHash]);

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

  const handleContentRender = useCallback(() => {
    const target = pendingHash.current;
    if (!target) return;

    const container = scrollRef.current;
    const element = container?.querySelector(
      `#${CSS.escape(target)}`
    ) as HTMLElement | null;
    if (container && element) {
      console.info("Scrolling to hash:", target);
      pendingHash.current = undefined; // Scroll only once, even if constituents render before the parent clears the hash.
      container.scrollTo({
        top: element.offsetTop,
        behavior: "auto",
      });
      setHashRef.current?.(undefined); // Clear the hash after scrolling to prevent repeated scrolling on re-render.
    }
  }, []);

  // This custom scroll effect is used to ensure that only the contents container scrolls and the nav / etc. remains untouched.
  // A new hash is taken over only when it changes, so that a parent that does not clear the hash (e.g. OnAsset) does not cause repeated scrolling.
  useLayoutEffect(() => {
    pendingHash.current = hash;
    handleContentRender();
  }, [hash, handleContentRender]);

  // If the target was not rendered yet, retry once the content (and, via the context, each constituent) has rendered.
  useLayoutEffect(() => {
    handleContentRender();
  }, [handleContentRender, nodeContent]);

  // Drop a target that was not found within SCROLL_TARGET_TIMEOUT after the content has rendered.
  useEffect(() => {
    if (hash === undefined || !contentShown) return;
    const timer = setTimeout(() => {
      if (pendingHash.current === undefined) return;
      console.info("Scroll target not found:", pendingHash.current);
      pendingHash.current = undefined;
      setHashRef.current?.(undefined);
    }, SCROLL_TARGET_TIMEOUT);
    return () => clearTimeout(timer);
  }, [hash, contentShown]);

  // A stable context lets the memoized StructuredContentList skip re-rendering the document when only the hash changes.
  const context = useMemo(
    () => ({
      depth: 0,
      openReference: nodePreviewFunction,
      handleContentRender: handleContentRender,
    }),
    [nodePreviewFunction, handleContentRender]
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
