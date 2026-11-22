import { BaseManagerContext } from "@/providers";
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

  // The pending scroll target and the latest setHash live in refs, so that the render callback below stays the same function and the rendering context stays stable.
  const pendingHash = useRef<string | undefined>(undefined);
  const setHashRef = useRef(setHash);
  useLayoutEffect(() => {
    setHashRef.current = setHash;
  }, [setHash]);

  const baseManager = useContext(BaseManagerContext);

  const nodePath = nodeID.split(".");
  const key = nodePath[0];

  const [nodeContent, setNodeContent] = useState<StructuredContent[] | null>(
    null
  );

  const setNodeContentFromItem = (item: Item) => {
    const node = getNode(nodeID, item);
    if (node) {
      setNodeContent(node.content);
    } else {
      setNodeContent(null);
    }
  };

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

    const unsubscribe = baseManager.subscribe(key, setNodeContentFromItem);

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
