import { debounce } from "@/utils/debouncer";
import { type Item, type ItemFlavor, type Tag } from "@/models";
import { getColorForFlavor, getIconForFlavorURL } from "@/utils";

import GraphologyGraph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2Layout from "graphology-layout-forceatlas2/worker";

export type NodeAttributes = {
  x: number;
  y: number;
  size: number;
  zIndex: number;
  color: string;
  image: string | null;
  flavor: ItemFlavor | "Tag" | "Unknown";
  hash: number;
  staleNode: boolean;
  type: "pictogram";
  // This is set when the item originates from the cache, so that we can give server updates precedence.
  //
  // It is only used for item nodes, not for tag nodes, which are always generated from the item content.
  fromCache?: boolean;
};

export type EdgeAttributes = {
  staleEdge?: boolean;
};

export type GraphAttributes = Record<string, never>;

export type Graph = GraphologyGraph<
  NodeAttributes,
  EdgeAttributes,
  GraphAttributes
>;

/**
 * A utility function to determine if an item flavor represents a "large" item in the graph.
 * Large items are typically those that have more complex structures or relationships, such as Knowledge items or items with specific flavors like Research, Report, Project, Teaching, Activity, Talk, or View.
 * @param flavor - The flavor of the item or "Tag".
 * @returns A boolean indicating whether the item is considered large.
 */
function isLargeItem(flavor: ItemFlavor | "Tag"): boolean {
  if (flavor === "Tag") {
    return false;
  }
  if (flavor === "Knowledge") {
    return true;
  }
  if (
    typeof flavor !== "string" &&
    ("Research" in flavor ||
      "Report" in flavor ||
      "Project" in flavor ||
      "Teaching" in flavor ||
      "Activity" in flavor ||
      "Talk" in flavor ||
      "View" in flavor)
  ) {
    return true;
  }
  return false;
}

/**
 * A utility function to hash a string into a pair of x and y coordinates.
 *
 * This is used to generate consistent positions for nodes in the graph based on their identifiers.
 * It is used to ensure that nodes have a consistent layout across different updates of the graph.
 */
function hashToXY(str: string): { x: number; y: number } {
  let hash = 0x811c9dc5;

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  // Mix to get two different values
  const h1 = hash >>> 0;
  const h2 = Math.imul(hash ^ 0x9e3779b9, 0x85ebca6b) >>> 0;

  return { x: h1 % 1001, y: h2 % 1001 };
}

/**
 * A manager for handling graph layouts and updates stemming from item changes.
 */
export class GraphManager {
  /**
   * The underlying graphology graph instance.
   */
  graph: Graph = new GraphologyGraph();

  /**
   * This map is used to override the hashed positions usually using cached positions from the previous graph.
   * This is a performance optimization to be able to display a reasonable layout of the graph before the layout algorithm has finished running.
   */
  positionOverride: Record<string, { x: number; y: number }> = {};

  /**
   * A handle for the layout algorithm that runs in a web worker.
   */
  layout: FA2Layout | null = null;

  /**
   * An interval during which the client is informed of the graph changes.
   */
  interval: ReturnType<typeof setInterval> | null = null;

  /**
   * The timeout after which the layout is stopped.
   */
  timeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * The callback function that is called whenever the graph is updated. This can be used to inform clients about changes to the graph.
   **/
  callback: ((graph: Graph) => void) | null = null;

  constructor(positionOverride: Record<string, { x: number; y: number }> = {}) {
    this.positionOverride = positionOverride;
  }

  /**
   * Returns the initial position for a node based on its key. If a cached position exists, it will be used; otherwise, a hash of the key will be used to generate a position.
   */
  initialPosition(key: string): { x: number; y: number } {
    // If we have a cached position, use it.
    const position = this.positionOverride[key];
    if (position) {
      return position;
    }
    // Otherwise, use a hash of the key to generate a position.
    return hashToXY(key);
  }

  /**
   * An internal method to add an edge between two nodes.
   *
   * If the source node does not exist, it will be created. Often it will be added again when the server updates the client with the item.
   * @param sourceID - The ID of the source node.
   * @param targetID - The ID of the target node.
   * @returns A boolean indicating whether a relayout is needed due to new nodes being added without previous positions.
   */
  addEdge(sourceID: string, targetID: string): boolean {
    let relayoutNeeded = false;
    if (!this.graph.hasEdge(sourceID, targetID)) {
      // if node with sourceID does not exist, create it
      if (!this.graph.hasNode(sourceID)) {
        this.graph.addNode(sourceID, {
          ...this.initialPosition(sourceID),
          size: 3,
          zIndex: 100,
          color: "rgba(255,0,0,0)",
          type: "pictogram",
          image: getIconForFlavorURL("Unknown", null),
          flavor: "Unknown" satisfies ItemFlavor | "Tag" | "Unknown",
          staleNode: false,
          hash: 0, // Use a date in the path such that any incoming item will overwrite this one.
        });
        relayoutNeeded = true;
      }
      if (!this.graph.hasNode(targetID)) {
        this.graph.addNode(targetID, {
          ...this.initialPosition(targetID),
          size: 3,
          zIndex: 100,
          color: "rgba(255,0,0,0)",
          type: "pictogram",
          image: getIconForFlavorURL("Unknown", null),
          flavor: "Unknown" satisfies ItemFlavor | "Tag" | "Unknown",
          staleNode: false,
          hash: 0, // Use a date in the path such that any incoming item will overwrite this one.
        });
        relayoutNeeded = true;
      }

      this.graph.addEdge(sourceID, targetID);
    } else {
      // If the edge already exists, we can mark it as not stale.
      const edgeKey = this.graph.edge(sourceID, targetID);
      this.graph.mergeEdgeAttributes(edgeKey, { staleEdge: false });
    }

    return relayoutNeeded;
  }

  /**
   * This internal update function for tags.
   *
   * @param parentID - The ID of the parent node (item or tag) to which the tags belong.
   * @param tags - An array of tags to be added to the graph.
   * @returns A boolean indicating whether a relayout is needed due to new nodes being added without previous positions.
   */
  updateNode(parentID: string, tags: Array<Tag>): boolean {
    let relayoutNeeded = false;
    for (const tag of tags.values()) {
      console.debug("Adding tag to graph:", tag);
      const key = `${parentID}.${tag.key}`;

      const newAttributes: Partial<NodeAttributes> = {
        type: "pictogram",
        size: 3,
        zIndex: 0,
        color: getColorForFlavor("Tag"),
        image: getIconForFlavorURL("Tag", null),
        flavor: "Tag" satisfies ItemFlavor | "Tag",
        staleNode: false,
        hash: Date.now(), // Use the current timestamp for tags, as they don't have a hash field
      };
      if (this.graph.hasNode(key)) {
        this.graph.mergeNodeAttributes(key, newAttributes);
      } else {
        this.graph.addNode(key, {
          ...this.initialPosition(key),
          ...newAttributes,
        } as NodeAttributes);
        relayoutNeeded = true;
      }

      if (this.addEdge(parentID, key)) {
        relayoutNeeded = true;
      }

      if (this.updateNode(key, tag.subtags)) {
        relayoutNeeded = true;
      }

      tag.subitems.forEach((subitemKey) => {
        if (this.addEdge(key, subitemKey)) {
          relayoutNeeded = true;
        }
      });
    }
    return relayoutNeeded;
  }

  /**
   * The public function to call when an item is updated.
   *
   * It resets the cached graph and updates the nodes and edges based on the item's content.
   */
  updateItem(item: Item, fromCache: boolean = false) {
    console.debug("Updating item in graph manager:", item);

    // Check whether the existing item is from the server.
    if (fromCache && this.graph.hasNode(item.key)) {
      const existingNodeAttributes = this.graph.getNodeAttributes(item.key);
      if (!existingNodeAttributes.fromCache) {
        console.debug(
          "Skipping update for item from cache because a server version already exists:",
          item.key
        );
        return;
      }
    }

    // Mark all nodes and their outgoing edges as stale.
    this.graph.forEachNode((nodeKey) => {
      if (nodeKey.includes(item.key)) {
        // Mark node as stale
        this.graph.mergeNodeAttributes(nodeKey, { staleNode: true });
        this.graph.outEdges(nodeKey).forEach((edgeKey) => {
          this.graph.mergeEdgeAttributes(edgeKey, {
            staleEdge: true,
          });
        });
      }
    });

    if (item.flavor !== "Constituent") {
      // Currently a relayout is only triggered if a new node appeared. A removal does not trigger it.
      let relayoutNeeded = false;

      const isLargeNode = isLargeItem(item.flavor);

      const newAttributes: Partial<NodeAttributes> = {
        type: "pictogram",
        size: isLargeNode ? 15 : 8,
        zIndex: isLargeNode ? 100 : 1,
        color: getColorForFlavor(item.flavor),
        image: getIconForFlavorURL(
          item.flavor,
          item.citation_information?.subtype ?? null
        ),
        flavor: item.flavor,
        hash: item.hash,
        staleNode: false,
        fromCache: fromCache,
      };

      if (this.graph.hasNode(item.key)) {
        this.graph.mergeNodeAttributes(item.key, newAttributes);
      } else {
        this.graph.addNode(item.key, {
          ...this.initialPosition(item.key),
          ...newAttributes,
        } as NodeAttributes);
        relayoutNeeded = true;
      }

      // Now iterate over the item's tags and add them as nodes and edges
      if (
        this.updateNode(
          item.key,
          item.content
            .filter((content): content is { Tag: Tag } => "Tag" in content)
            .map((content) => content.Tag)
        )
      ) {
        relayoutNeeded = true;
      }

      if (relayoutNeeded) {
        this.debouncedResyncLayout(); // Trigger a relayout if needed
      }
    }

    // Delete stale nodes and edges after processing the item.
    this.graph.forEachNode((nodeKey, attributes) => {
      if (attributes.staleNode) {
        this.graph.dropNode(nodeKey);
      }
    });
    this.graph.forEachEdge((edgeKey, edgeAttributes) => {
      if (edgeAttributes.staleEdge) {
        this.graph.dropEdge(edgeKey);
      }
    });
  }

  /**
   * The public function to call when an item is removed.
   * @param itemKey - The key of the item to be removed.
   */
  removeItem(itemKey: string) {
    console.debug("Removing item from graph manager:", itemKey);

    // Mark all nodes and their outgoing edges as stale.
    this.graph.forEachNode((nodeKey) => {
      if (nodeKey.includes(itemKey)) {
        // Mark node as stale
        this.graph.mergeNodeAttributes(nodeKey, { staleNode: true });
        this.graph.outEdges(nodeKey).forEach((edgeKey) => {
          this.graph.mergeEdgeAttributes(edgeKey, {
            staleEdge: true,
          });
        });
      }
    });

    // Delete stale nodes and edges after processing the item.
    this.graph.forEachNode((nodeKey, attributes) => {
      if (attributes.staleNode) {
        this.graph.dropNode(nodeKey);
      }
    });
    this.graph.forEachEdge((edgeKey, edgeAttributes) => {
      if (edgeAttributes.staleEdge) {
        this.graph.dropEdge(edgeKey);
      }
    });
  }

  /**
   * Sets the callback function that will be called whenever the graph is updated. This can be used to inform clients about changes to the graph.
   */
  setCallbackFunction(callback: (graph: Graph) => void) {
    this.callback = callback;

    this.debouncedResyncLayout(); // Trigger a relayout when the callback is set. Note that this will also update the callback function used in the set interval and trigger at least one callback call to the client with the current graph.
  }

  /**
   * Returns the current positions of all nodes in the graph.
   * @returns A record mapping node keys to their x and y coordinates.
   */
  getCurrentPositions(): Record<string, { x: number; y: number }> {
    const positions: Record<string, { x: number; y: number }> = {};
    this.graph.forEachNode((nodeKey, attributes) => {
      positions[nodeKey] = { x: attributes.x, y: attributes.y };
    });
    return positions;
  }

  /**
   * Returns the current graph.
   */
  async getGraph(): Promise<Graph> {
    return this.graph;
  }

  /**
   * Restarts the layout process for the graph, stopping any existing layout and starting a new one with inferred settings. It also sets up intervals to inform clients about graph changes and stops the layout after a specified timeout.
   *
   * Note that this function also starts an interval to inform the clients about changes to the layout and graph.
   */
  async resyncLayout() {
    if (this.layout) {
      this.layout.kill(); // Stop the layout if it's running
      this.layout = null; // Clear the layout reference
    }

    const sensibleSettings = forceAtlas2.inferSettings(this.graph);
    this.layout = new FA2Layout(this.graph, {
      settings: {
        ...sensibleSettings,
        adjustSizes: true, // Adjust node sizes during layout
      },
    });

    this.layout.start(); // Start the layout process

    if (this.timeout) {
      clearTimeout(this.timeout); // Clear any existing timeout
    }
    if (this.interval) {
      clearInterval(this.interval); // Clear any existing interval
    }

    this.interval = setInterval(() => {
      if (this.callback) {
        this.callback(this.graph); // Call the callback function with the current graph
      }
    }, 100);

    this.timeout = setTimeout(() => {
      this.layout?.stop(); // Stop the layout after a certain time (e.g., 5 seconds)
      if (this.interval) {
        clearInterval(this.interval); // Clear the interval when stopping the layout
      }
    }, 120000); // Adjust the time as needed
  }

  /**
   * Debounced version of resyncLayout to prevent excessive calls during rapid updates.
   */
  debouncedResyncLayout = debounce(this.resyncLayout.bind(this), 1000);
}
