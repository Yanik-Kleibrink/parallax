import { BaseManagerContext } from "@/providers";
import { StructuredSectionRenderer, NodePreview } from "@/components";
import type { Item, StructuredContent } from "@/models";
import { getNode } from "@/utils";

import { useContext, useEffect, useState } from "react";

import "./NodeDetails.scss";

/**
 * NodeDetails component displays the details of a node (Item or Tag) based on its nodeID.
 */
export function NodeDetails({
  nodeID,
  collapsed,
  openLink,
}: {
  nodeID: string;
  collapsed?: boolean;
  openLink?: (key: string) => void;
}) {
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
    if (!baseManager) return;

    const unsubscribe = baseManager.subscribe(key, setNodeContentFromItem);

    baseManager
      .retrieve(key)
      .then(setNodeContentFromItem)
      .catch(() => {}); // Note an error could be thrown if the backend needs to request the item from the server.

    return unsubscribe;
  }, [baseManager, key]);

  return (
    <>
      <NodePreview nodeID={nodeID} collapsed={collapsed} />
      <div className="node-details__toc">
        <ul className="node-details__toc__list">
          {nodeContent &&
            nodeContent.map((content, index) => (
              <StructuredSectionRenderer
                key={index}
                content={content}
                context={{
                  openLink: openLink,
                }}
              />
            ))}
        </ul>
      </div>
    </>
  );
}
