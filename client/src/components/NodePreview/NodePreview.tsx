import { BaseManagerContext } from "@/providers";
import { StructuredContentRenderer } from "@/components";
import type { Item, Tag, MiniNodeFlavor } from "@/models";
import { toMiniNodeFlavor } from "@/models";
import {
  getColorForFlavor,
  getIconForFlavorReact,
  getMiniIconForFlavorReact,
  getMainColorForFlavor,
  getNonConstituentChildren,
  getNode,
} from "@/utils";

import { useContext, useEffect, useState } from "react";
import Graph from "graphology";

import "./NodePreview.scss";

export function NodePreview({
  nodeID,
  collapsed,
}: {
  nodeID: string;
  collapsed?: boolean;
}) {
  const baseManager = useContext(BaseManagerContext);

  // If the node references a tag there will be several subitems.
  const nodePath = nodeID.split(".");
  const key = nodePath[0];

  const [node, setNode] = useState<Item | Tag | null>(null);
  const [childStatistics, setChildStatistics] = useState<
    Map<MiniNodeFlavor | "Tag", number>
  >(new Map());

  const flavor = node ? ("flavor" in node ? node.flavor : "Tag") : null;

  const Icon = node
    ? getIconForFlavorReact(
        flavor!,
        "citation_information" in node && node.citation_information?.subtype
          ? node.citation_information.subtype
          : null
      )
    : null;

  useEffect(() => {
    if (!baseManager) return;
    const setItem = (item: Item) => {
      const node = getNode(nodeID, item);
      if (node) {
        setNode(node);
      } else {
        setNode(null);
      }
    };

    return baseManager.subscribe(key, setItem);
  }, [baseManager, key, nodeID]);

  useEffect(() => {
    if (!baseManager) return;
    const updateChildStatistics = (graph: Graph) => {
      const childrenFocusNode = getNonConstituentChildren(graph, nodeID);
      setChildStatistics(
        [...childrenFocusNode.entries()]
          .filter(([key]) => key !== nodeID) // Exclude the focus node itself from child statistics
          .map(([, flavor]) => flavor)
          .filter((flavor) => flavor !== undefined && flavor !== "Unknown")
          .map(toMiniNodeFlavor)
          .reduce((map, name) => {
            const key = name as MiniNodeFlavor;
            map.set(key, (map.get(key) || 0) + 1);
            return map;
          }, new Map<MiniNodeFlavor, number>())
      );
    };

    return baseManager.subscribeGlobal(updateChildStatistics);
  }, [baseManager, nodeID]);

  return (
    <div
      className={["node-preview", collapsed && "node-preview--collapsed"]
        .filter(Boolean)
        .join(" ")}
    >
      {node && Icon && (
        <Icon
          color={getColorForFlavor(flavor!)}
          className="node-preview__icon"
        />
      )}

      <div className="node-preview__information">
        {node &&
        "flavor" in node &&
        node.flavor === "GeneralReference" &&
        "citation_information" in node &&
        node.citation_information?.subtype &&
        node.citation_information.subtype === "Discussion" ? (
          <>
            <div className="node-preview__information__main">
              {node.citation_information.authors.map((author, index) => (
                <span key={index} className="node-preview__information__author">
                  {author}
                  {index < node.citation_information!.authors.length - 1
                    ? ", "
                    : ""}
                </span>
              ))}
            </div>
            <div className="node-preview__information__auxiliary">
              <span>{node.citation_information.location}</span>
              {"\u00A0"}(
              <span>
                {node.citation_information.day !== null
                  ? `${node.citation_information.day + 1}.`
                  : ""}
                {node.citation_information.month !== null
                  ? `${node.citation_information.month + 1}.`
                  : ""}
                {node.citation_information.year}
              </span>
              )
            </div>
          </>
        ) : (
          <>
            <div className="node-preview__information__main">
              <span>
                {node && node.title
                  ? node.title.map((content, index) => (
                      <StructuredContentRenderer
                        key={index}
                        content={content}
                        context={{ depth: 0 }}
                      />
                    ))
                  : null}
              </span>
            </div>
            {node &&
              "citation_information" in node &&
              node.citation_information && (
                <div className="node-preview__information__auxiliary">
                  {node.citation_information.authors.map((author, index) => (
                    <span
                      key={index}
                      className="node-preview__information__author"
                    >
                      {author}
                      {index < node.citation_information!.authors.length - 1
                        ? ", "
                        : ""}
                    </span>
                  ))}
                </div>
              )}
          </>
        )}

        {childStatistics &&
          childStatistics.size > 0 &&
          [...childStatistics.values()].reduce((a, b) => a + b, 0) > 0 && (
            <div className="node-preview__statistics">
              {Array.from(childStatistics.entries()).map(([flavor, count]) => {
                if (count > 0) {
                  const MiniIcon = getMiniIconForFlavorReact(
                    flavor as MiniNodeFlavor
                  );
                  return (
                    <span
                      key={flavor}
                      className="node-preview__statistics__item"
                      style={{
                        backgroundColor: getMainColorForFlavor(
                          flavor as MiniNodeFlavor
                        ),
                      }}
                    >
                      <MiniIcon
                        color="white"
                        className="node-preview__statistics__item__icon"
                      />
                      <span className="node-preview__statistics__item__value">
                        {count}
                      </span>
                    </span>
                  );
                }
              })}
            </div>
          )}
      </div>
    </div>
  );
}
