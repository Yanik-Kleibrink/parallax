import type { ItemFlavor } from "@/models";

import Graph from "graphology";

/**
 * Returns a map of all non-constituent parents of the given node in the graph.
 * @param graph The graph to traverse.
 * @param nodeId The ID of the node to start from.
 **/
export function getNonConstituentParents(
  graph: Graph,
  nodeId: string
): Map<string, ItemFlavor> {
  const parentsFocusNode = new Map<string, ItemFlavor>();
  const stack = [nodeId];

  parentsFocusNode.set(nodeId, graph.getNodeAttribute(nodeId, "flavor"));

  while (stack.length) {
    const node = stack.pop();

    graph.forEachInNeighbor(node, (parent, attributes) => {
      if (!parentsFocusNode.has(parent)) {
        parentsFocusNode.set(parent, attributes.flavor);
        // Only traverse upwards until we reach a non-tag.
        if (attributes.flavor === "Tag") {
          stack.push(parent);
        }
      }
    });
  }

  return parentsFocusNode;
}

/**
 * Returns a map of all non-constituent children of the given node in the graph.
 * @param graph The graph to traverse.
 * @param nodeId The ID of the node to start from.
 **/
export function getNonConstituentChildren(
  graph: Graph,
  nodeId: string
): Map<string, ItemFlavor> {
  const childrenFocusNode = new Map<string, ItemFlavor>();
  const stack = [nodeId];

  childrenFocusNode.set(nodeId, graph.getNodeAttribute(nodeId, "flavor"));

  while (stack.length) {
    const node = stack.pop();

    graph.forEachOutNeighbor(node, (child, attributes) => {
      if (!childrenFocusNode.has(child)) {
        childrenFocusNode.set(child, attributes.flavor);
        // Only traverse upwards until we reach a non-tag.
        if (attributes.flavor === "Tag") {
          stack.push(child);
        }
      }
    });
  }

  return childrenFocusNode;
}
