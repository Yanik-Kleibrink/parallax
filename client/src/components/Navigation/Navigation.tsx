import {
  BaseManagerContext,
  type Graph,
  type NodeAttributes,
  type EdgeAttributes,
  type GraphAttributes,
} from "@/providers";
import {
  getNonConstituentParents,
  getNonConstituentChildren,
  adjustStateColor,
} from "@/utils";
import { NodePreview } from "@/components";
import type { ItemFlavor } from "@/models";

import { useContext } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import type { NodeDisplayData, EdgeDisplayData } from "sigma/types";
import {
  SigmaContainer,
  useRegisterEvents,
  useSetSettings,
} from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";
import Sigma from "sigma";
import { createNodeImageProgram } from "@sigma/node-image";
import { DEFAULT_SETTINGS } from "sigma/settings";
import type { Settings } from "sigma/settings";

import "./Navigation.scss";

const sigmaStyle = { height: "100%", width: "100%" };

// Component that loads the graph
export function GraphController({
  defaultNode,
  searchQuery,
  sigma,
  focusNode,
  temporaryDefaultNode,
  setFocusNode,
  setTemporaryDefaultNode,
}: {
  defaultNode: string | null;
  searchQuery?: string;
  sigma: Sigma<NodeAttributes, EdgeAttributes, GraphAttributes> | null;
  focusNode: string | null;
  temporaryDefaultNode: string | null;
  setFocusNode: (node: string | null) => void;
  setTemporaryDefaultNode: (node: string | null) => void;
}) {
  const [parentsFocusNode, setParentsFocusNode] = useState<
    Map<string, ItemFlavor>
  >(new Map());
  const [childrenFocusNode, setChildrenFocusNode] = useState<
    Map<string, ItemFlavor>
  >(new Map());
  const [searchQueryNodes, setSearchQueryNodes] = useState<Array<string>>([]);

  const registerEvents = useRegisterEvents();
  const setSettings = useSetSettings();
  const baseManager = useContext(BaseManagerContext);
  const navigate = useNavigate();

  // We directly use the setGraph method of sigma as this does not copy the graph but replaces it.
  // This is important for ensuring that event listeners are not lost when the graph is updated.
  // In particular, there is no flickering when a node is hovered on and the graph is updated.
  useEffect(() => {
    if (!baseManager) return;
    const updateGraph = (graph: Graph) => {
      if (!sigma) return;

      sigma.setGraph(graph);

      let parentsFocusNode = new Map<string, ItemFlavor>();
      let childrenFocusNode = new Map<string, ItemFlavor>();
      if (focusNode) {
        parentsFocusNode = getNonConstituentParents(graph, focusNode);
        childrenFocusNode = getNonConstituentChildren(graph, focusNode);
      }
      setParentsFocusNode(parentsFocusNode);
      setChildrenFocusNode(childrenFocusNode);
    };
    return baseManager.subscribeGlobal(updateGraph);
  }, [sigma, focusNode, baseManager]);

  useEffect(() => {
    if (!sigma) return;

    const graph = sigma.getGraph();

    const checkNodeNonEmphasis = (node: string) => {
      // Search is not used when a defaultNode is set.
      if (focusNode) {
        if (!childrenFocusNode.has(node) && !parentsFocusNode.has(node)) {
          return true;
        }
        return false;
      } else if (searchQuery && searchQuery != "") {
        return !searchQueryNodes.includes(node);
      }
      return false;
    };

    setSettings({
      nodeReducer: (node: string, data: Partial<NodeDisplayData>) => {
        const res: Partial<NodeDisplayData> = { ...data };

        if (checkNodeNonEmphasis(node)) {
          res.color = adjustStateColor(data.color!, true);
          // Ensure you don't multiply undefined by 100
          res.zIndex = data.zIndex ? data.zIndex * 100 : 0;
        } else {
          if (!focusNode && searchQuery && searchQuery != "") {
            res.highlighted = true;
          }
        }

        return res;
      },
      edgeReducer: (edge: string, data: Partial<EdgeDisplayData>) => {
        const res: Partial<EdgeDisplayData> = { ...data };
        try {
          // Note that this can produce an edge not found error as the graph
          // in this function might be stale.
          const source = graph.source(edge);
          const target = graph.target(edge);

          if (checkNodeNonEmphasis(source) || checkNodeNonEmphasis(target)) {
            res.color = "gray";
          } else {
            res.color = "black";
          }
        } catch (error) {
          console.warn("Error in edgeReducer:", error);
        }

        return res;
      },
    });
  }, [
    sigma,
    searchQueryNodes,
    childrenFocusNode,
    parentsFocusNode,
    focusNode,
    defaultNode,
    searchQuery,
    setSettings,
  ]);

  useEffect(() => {
    if (!searchQuery || !baseManager) return;
    return baseManager.subscribeSearch(searchQuery, setSearchQueryNodes);
  }, [searchQuery, baseManager]);

  useEffect(() => {
    registerEvents({
      enterNode: (event) => {
        setFocusNode(event.node);
      },
      leaveNode: () => {
        setFocusNode(temporaryDefaultNode ? temporaryDefaultNode : defaultNode);
      },
      clickNode: (event) => {
        setTemporaryDefaultNode(event.node);
        setFocusNode(temporaryDefaultNode ? temporaryDefaultNode : defaultNode);
      },
      clickStage: () => {
        setTemporaryDefaultNode(null);
        setFocusNode(temporaryDefaultNode ? temporaryDefaultNode : defaultNode);
      },
      rightClickNode: (event) => {
        navigator.clipboard.writeText(event.node);
        event.event.original.preventDefault();
        event.preventSigmaDefault();
      },
      doubleClickNode: (event) => {
        navigate(`/${baseManager?.getName()}/${event.node}`);
        event.event.original.preventDefault();
        event.preventSigmaDefault();
      },
    });
  }, [
    registerEvents,
    temporaryDefaultNode,
    setTemporaryDefaultNode,
    setFocusNode,
    defaultNode,
    navigate,
    baseManager,
  ]);

  return null;
}

function customZoomToSizeRatioFunction(x: number): number {
  return 0.5 * DEFAULT_SETTINGS.zoomToSizeRatioFunction(x);
}

/**
 *   Navigation uses a strongly typed version.
 *
 *   Hence the NodePictogramProgram is recreated here with the correct attribute types.
 *   Note that the other configuration options stem from the exported NodePictogramProgram
 *   in node-image.
 */
const NodePictogramProgram = createNodeImageProgram<
  NodeAttributes,
  EdgeAttributes,
  GraphAttributes
>({
  keepWithinCircle: false,
  size: { mode: "force", value: 256 },
  drawingMode: "color",
  correctCentering: true,
});

/**
 *   The navigation view in terms of a graph.
 *
 *   @param defaultNode the node whose parents and children are emphasized when no other node is focused or hovered.
 *   @param searchQuery a search string with the nodes satisfying the resulting search being emphasized. It should
 *                      never be set at the same time as defaultNode.
 *   @param setPreviewActive a callback used to inform parents when the preview window is open.
 */
export function Navigation({
  defaultNode,
  searchQuery,
  setPreviewActive,
}: {
  defaultNode: string | null;
  searchQuery?: string;
  setPreviewActive?: (active: boolean) => void;
}) {
  const [focusNode, setFocusNode] = useState<string | null>();
  const [temporaryDefaultNode, setTemporaryDefaultNode] = useState<
    string | null
  >(null);
  const [sigma, setSigma] = useState<Sigma<
    NodeAttributes,
    EdgeAttributes,
    GraphAttributes
  > | null>(null);

  const sigmaSettings = {
    zIndex: true,
    allowInvalidContainer: true,
    itemSizesReference: "positions",
    nodeProgramClasses: {
      pictogram: NodePictogramProgram,
    },
    zoomToSizeRatioFunction: customZoomToSizeRatioFunction,
  } satisfies Partial<
    Settings<NodeAttributes, EdgeAttributes, GraphAttributes>
  >;

  useEffect(
    () =>
      setPreviewActive
        ? setPreviewActive(!!focusNode && focusNode !== defaultNode)
        : undefined,
    [focusNode, defaultNode, setPreviewActive]
  );

  return (
    <nav className="navigation">
      <SigmaContainer<NodeAttributes, EdgeAttributes, GraphAttributes>
        ref={setSigma}
        style={sigmaStyle}
        settings={sigmaSettings} // Pass the memoized settings
      >
        <GraphController
          defaultNode={defaultNode}
          searchQuery={searchQuery}
          sigma={sigma}
          focusNode={focusNode ?? null}
          temporaryDefaultNode={temporaryDefaultNode}
          setFocusNode={setFocusNode}
          setTemporaryDefaultNode={setTemporaryDefaultNode}
        />
      </SigmaContainer>
      {focusNode && focusNode !== defaultNode && (
        <div
          className="navigation__focus-node"
          onClick={(e) => {
            e.stopPropagation();
            // Copy the node ID to the clipboard
            navigator.clipboard.writeText(focusNode);
          }}
        >
          <NodePreview nodeID={focusNode} />
        </div>
      )}
    </nav>
  );
}
