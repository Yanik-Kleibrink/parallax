import { BaseManagerContext } from "@/providers";
import { StructuredContentRenderer } from "@/components";
import type { Item, StructuredContent } from "@/models";
import { getNode } from "@/utils";

import {
  useContext,
  useEffect,
  useState,
  useRef,
  useLayoutEffect,
} from "react";

import "./NodeContent.scss";

export function NodeContent({
  nodeID,
  nodePreviewFunction = undefined,
}: {
  nodeID: string;
  nodePreviewFunction?: (nodeID: string) => void;
}) {
  const lastScrollHash = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [handleContentRender, setHandleContentRender] = useState<() => void>(
    () => () => {}
  );

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

  useEffect(() => {
    setHandleContentRender(() => () => {
      if (!location.hash) return;
      if (lastScrollHash.current === location.hash) return;

      console.log("Scrolling to hash:", location.hash);

      const container = scrollRef.current;
      const element = container?.querySelector(
        `#${location.hash.slice(1)}`
      ) as HTMLElement | null;
      if (container && element) {
        container.scrollTo({
          top: element.offsetTop,
          behavior: "smooth",
        });
        lastScrollHash.current = location.hash;
      }
    });
  }, [location.hash, scrollRef, lastScrollHash]);

  //. This custom scroll effect is used to ensure that only the contents container scrolls and the nav / etc. remains untouched.
  useLayoutEffect(() => {
    if (!handleContentRender) return;
    handleContentRender();
  }, [handleContentRender, location.hash, nodeContent]);

  useEffect(() => {
    if (!baseManager) return;

    const unsubscribe = baseManager.subscribe(key, setNodeContentFromItem);

    baseManager
      .retrieve(key)
      .then(setNodeContentFromItem)
      .catch(() => {}); // Note an error could be thrown if the backend needs to request the item from the server.

    return unsubscribe;
  }, [baseManager, key]);

  return (
    <div ref={scrollRef} className="node-content-wrapper">
      <div className="node-content-container">
        <div className="node-content">
          {nodeContent &&
            nodeContent.map((content, index) => (
              <StructuredContentRenderer
                key={index}
                content={content}
                context={{
                  depth: 0,
                  openReference: nodePreviewFunction,
                  handleContentRender: handleContentRender,
                }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
