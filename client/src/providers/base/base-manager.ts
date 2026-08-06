import type {
  Base,
  Item,
  ItemFreshness,
  ItemInformation,
  ItemAsset,
} from "@/models";
import {
  addItem,
  getItem,
  getNonConstituents,
  getCachedPositions,
  setCachedPositions,
  getAllItemFreshness,
  removeItem,
  removeAllItems,
  connectedToBase,
} from "@/providers/db";
import { convertToString, debounce } from "@/utils";
import { GraphManager, type Graph } from "./graph-manager";

import { createContext } from "react";
import Fuse from "fuse.js";

/**
 * This type represents an item that can be searched using Fuse.js.
 */
type FuseSearchItem = {
  key: string;
  title: string;
  authors: string[];
  year: number | null;
};

/**
 * This class manages the WebSocket connection to a specific base and handles the retrieval and subscription of items.
 *
 * It maintains a list of requested items and notifies listeners when updates are received.
 */
export class BaseManager {
  /**
   * The base that this manager is connected to.
   */
  base: Base;

  /**
   * A map of listeners for specific items. The key is the item name, and the value is a set of callback functions that will be called when the item is updated.
   */
  listeners: Map<string, Set<(result: Item) => void>>;

  /**
   * A set of listeners to any item. This is necessary for the navigation.
   */
  listenersGlobal: Set<(graph: Graph) => void>;

  /**
   * A set of listeners for the connection status of the websocket.
   */
  listenersConnectionStatus: Set<(result: boolean) => void>;

  /**
   * A map of listeners for search results. The key is the search query, and the value is a set of callback functions that will be called when the search results are updated.
   */
  listenersSearch: Map<string, Set<(searchResult: Array<string>) => void>>;

  /**
   * This array is updated upon changes and is used by fuse to implement the search.
   */
  searchableData: Array<FuseSearchItem> = [];

  fuseSearch: Fuse<FuseSearchItem> | null = null;

  /**
   * The WebSocket connection to the base. This will be null if the connection is not established.
   */
  ws: null | WebSocket;

  /**
   * A set of items that have been requested but not yet received. This is used to avoid sending duplicate requests for the same item.
   */
  requested_items: Set<string>;

  // Logic for retrying connections
  retryCount: number;
  baseDelay: number;
  maxDelay: number;

  /**
   * This is the graph manager that is used to update the clients.
   */
  graphManager: GraphManager | null;

  /**
   * This backup graph manager is always initialized with no position overrides.
   *
   * Hence it computes the "true" node positions. After 2min (when the graph should have stabilized), the graph manager is replaced with this backup graph manager.
   * This ensures that the user always has a good graph layout to work with.
   */
  backupGraphManager: GraphManager | null;

  constructor(base: Base) {
    console.info("BaseManager created for base:", base);

    this.base = base;
    this.listeners = new Map();
    this.listenersGlobal = new Set();
    this.listenersConnectionStatus = new Set();
    this.listenersSearch = new Map();

    this.requested_items = new Set();

    this.ws = null;

    // Logic for retrying connections
    this.retryCount = 0;
    this.baseDelay = 1000; // 1 second
    this.maxDelay = 30000; // 30 seconds

    // Prepare the search
    this.populateSearchableDataDefault();

    this.graphManager = null;
    this.backupGraphManager = null;

    this.backupGraphManager = new GraphManager();
    // Now push all items from the database into the graph manager.
    getNonConstituents(this.base.name)
      .then((nonConstituents) => {
        nonConstituents.forEach((nonConstituent) => {
          getItem(this.base.name, nonConstituent).then((item) => {
            this.backupGraphManager?.updateItem(item);
          });
        });
      })
      .catch((err) => {
        console.error("Error retrieving non-constituents from database:", err);
      });

    getCachedPositions(this.base.name)
      .then(async (result) => {
        const [cachedPositions, timestamp] = result;

        console.info(
          "Cached positions retrieved from database:",
          cachedPositions
        );

        this.graphManager = new GraphManager(cachedPositions);
        this.graphManager.setCallbackFunction(
          this.graphCallbackFunction.bind(this)
        );

        // Now push all items from the database into the graph manager.
        this.populateGraphManagerDefault(this.graphManager);

        // Don't recompute these positions if they are less than 24 hours old. This is to avoid recomputing the positions too often, which can be expensive.
        if (timestamp < Date.now() - 24 * 60 * 1000) {
          console.info(
            "Cached positions are older than 24 hours, recomputing positions"
          );
          // Create the backup graph manager
          this.backupGraphManager = new GraphManager();
          this.populateGraphManagerDefault(this.backupGraphManager);

          // After 2 minutes, replace the graph manager with the backup graph manager.
          setTimeout(
            () => {
              console.info(
                "Replacing graph manager with backup graph manager after 5 minutes"
              );
              this.graphManager?.setCallbackFunction(() => {}); // Disable the callback function of the current graph manager
              this.graphManager = this.backupGraphManager;
              this.graphManager!.setCallbackFunction(
                this.graphCallbackFunction.bind(this)
              );

              // Start updating the cached positions every 2 minutes.
              // IMPORTANT: This is only done if we started from a blank graph manager.
              setInterval(
                () => {
                  console.info("Updating cached positions in the database");
                  setCachedPositions(
                    this.base.name,
                    this.graphManager!.getCurrentPositions()
                  );
                },
                2 * 60 * 1000
              );
            },
            5 * 60 * 1000
          );
        } else {
          console.info(
            "Cached positions are newer than 24 hours, reusing positions"
          );
        }
      })
      .catch(() => {
        this.graphManager = new GraphManager();

        this.graphManager.setCallbackFunction(
          this.graphCallbackFunction.bind(this)
        );

        this.populateGraphManagerDefault(this.graphManager);
      });

    this.connect();
  }

  /**
   * Populates the passed graph manager with all items from the database.
   *
   * Note that the graph manager is passed by reference.
   *
   * @param graphManager The graph manager to populate with items from the database.
   */
  populateGraphManagerDefault(graphManager: GraphManager) {
    // Now push all items from the database into the graph manager.
    getNonConstituents(this.base.name)
      .then((nonConstituents) => {
        nonConstituents.forEach((nonConstituent) => {
          getItem(this.base.name, nonConstituent).then((item) => {
            graphManager.updateItem(item);
          });
        });
      })
      .catch((err) => {
        console.error("Error retrieving non-constituents from database:", err);
      });
  }

  /** Populates the searchable data with all items from the database.
   *
   */
  populateSearchableDataDefault() {
    // Now push all items from the database into the searchable data.
    getNonConstituents(this.base.name)
      .then((nonConstituents) => {
        nonConstituents.forEach((nonConstituent) => {
          getItem(this.base.name, nonConstituent).then((item) => {
            this.addItemToSearchableData(item);
          });
        });
      })
      .catch((err) => {
        console.error("Error retrieving non-constituents from database:", err);
      });
  }

  connect() {
    console.info(
      `Attempting to connect to WebSocket at ws://${this.base.domain}:${this.base.port}/ws`
    );

    if (this.base.tls) {
      // wss is for TLS
      this.ws = new WebSocket(
        `wss://${this.base.domain}:${this.base.port}/ws`,
        this.base.jwt ? [this.base.jwt] : undefined
      );
    } else {
      this.ws = new WebSocket(
        `ws://${this.base.domain}:${this.base.port}/ws`,
        this.base.jwt ? [this.base.jwt] : undefined
      );
    }

    this.ws.onopen = () => {
      console.info("WebSocket connection established");
      this.retryCount = 0; // Reset retry count on successful connection

      // Inform listeners about connection status
      this.listenersConnectionStatus.forEach((cb) => cb(true));

      // Now, handle any updates that were requested while disconnected
      this.requested_items.forEach((name) => {
        console.debug("Sending queued request for item:", name);
        this.ws?.send(name);
      });
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const item_information = data as ItemInformation;

      // console.debug("Received data from WebSocket:", data);

      // Check if data is an array of items
      // This is the list of updated items.
      if ("Inventory" in item_information) {
        const configHash = item_information.Inventory[1];
        connectedToBase(this.base.name, configHash).then(() => {
          const serverItemFreshnesses = item_information
            .Inventory[0] as ItemFreshness[];
          // Compare the config hash with the one stored in the database.
          // If they are different, we need to clear the database and update all items.
          if (configHash !== this.base.configHash) {
            removeAllItems(this.base.name).then(() => {
              serverItemFreshnesses.forEach((itemFreshness) => {
                this.requestUpdate(itemFreshness.key);
              });
            });
          } else {
            getAllItemFreshness(this.base.name).then(
              (clientItemFreshnesses) => {
                const upToDateItems = serverItemFreshnesses.filter(
                  (serverItem) => {
                    const clientItem = clientItemFreshnesses.find(
                      (clientItem) => clientItem.key === serverItem.key
                    );
                    return (
                      clientItem !== undefined &&
                      clientItem.hash == serverItem.hash
                    );
                  }
                );

                const staleItems = serverItemFreshnesses.filter(
                  (serverItem) => {
                    const clientItem = clientItemFreshnesses.find(
                      (clientItem) => clientItem.key === serverItem.key
                    );
                    return (
                      clientItem === undefined ||
                      clientItem.hash !== serverItem.hash
                    );
                  }
                );

                const toDeleteItems = clientItemFreshnesses.filter(
                  (clientItem) => {
                    const serverItem = serverItemFreshnesses.find(
                      (serverItem) => serverItem.key === clientItem.key
                    );
                    return serverItem === undefined;
                  }
                );

                // Insert the up-to-date items into the graph manager and searchable data.
                upToDateItems.forEach((itemFreshness) => {
                  getItem(this.base.name, itemFreshness.key).then(
                    (existingItem) => {
                      if (existingItem !== undefined) {
                        this.graphManager?.updateItem(existingItem);
                        this.backupGraphManager?.updateItem(existingItem);
                        this.addItemToSearchableData(existingItem);
                      }
                    }
                  );
                });

                // Delete the items that are no longer present on the server.
                toDeleteItems.forEach((itemFreshness) => {
                  removeItem(this.base.name, itemFreshness.key);
                  this.graphManager?.removeItem(itemFreshness.key);
                  this.backupGraphManager?.removeItem(itemFreshness.key);
                  this.searchableData = this.searchableData.filter(
                    (data) => data.key !== itemFreshness.key
                  );
                  this.deboundedRebuildFuseSearchIndex();
                });

                // Request updates for the stale items.
                staleItems.forEach((itemFreshness) => {
                  this.requestUpdate(itemFreshness.key);
                });
              }
            );
          }
        });
      } else if ("Remove" in item_information) {
        console.info("Removing item from database:", item_information.Remove);
        // Remove the item from the database and graph managers.
        removeItem(this.base.name, item_information.Remove);
        this.graphManager?.removeItem(item_information.Remove);
        this.backupGraphManager?.removeItem(item_information.Remove);
      } else if ("Update" in item_information) {
        const item = item_information.Update;
        this.requested_items.delete(item.key);

        //      console.debug("Storing item in database:", item);
        addItem(this.base.name, item);
        this.addItemToSearchableData(item);

        // Update the graph with the new item.
        this.graphManager?.updateItem(item);
        this.backupGraphManager?.updateItem(item);

        const callbacks = this.listeners.get(item.key);
        if (callbacks) {
          callbacks.forEach((cb) => cb(item));
        }
      } else {
        console.error("Unknown item information type:", item_information);
      }
    };

    this.ws.onclose = () => {
      console.info("WebSocket connection closed");

      // Inform listeners about connection status
      this.listenersConnectionStatus.forEach((cb) => cb(false));

      this.retry();
    };
  }

  /**
   * Retry connecting to the websocket with exponential backoff
   */
  retry() {
    const delay = Math.min(
      this.baseDelay * 2 ** this.retryCount,
      this.maxDelay
    );

    console.info(`Reconnecting in ${delay}ms...`);
    this.retryCount++;

    setTimeout(() => this.connect(), delay);
  }

  // Websocket management

  /**
   * Check if the WebSocket connection is currently open.
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Shut down the WebSocket connection
   */
  dispose() {
    this.ws?.close();
  }

  /**
   * This function retrieves the name of the base that this manager is connected to.
   */
  getName(): string {
    return this.base.name;
  }

  /**
   * This function retrieves the base object that this manager is connected to.
   */
  getBase(): Base {
    return this.base;
  }

  /**
   * This function will request an update for a specific item.
   *
   * Note that if the WebSocket is not connected, the request will be queued and will be sent upon reconnection.
   * @param name The name of the item to request an update for.
   */
  requestUpdate(name: string) {
    console.info(`Requesting update for item: ${name}`);
    this.requested_items.add(name);
    if (this.ws?.readyState == WebSocket.OPEN) {
      console.info("WebSocket ready");
      this.ws?.send(name);
    }
  }

  // Functions to manage search results.
  addItemToSearchableData(item: Item) {
    this.searchableData = this.searchableData.filter(
      (data) => data.key !== item.key
    );
    this.searchableData.push({
      key: item.key,
      title:
        "citation_information" in item && item.citation_information
          ? item.citation_information.title
          : convertToString(item.title ?? []),
      authors:
        "citation_information" in item && item.citation_information
          ? item.citation_information.authors
          : [],
      year:
        "citation_information" in item && item.citation_information
          ? item.citation_information.year
          : null,
    });
    this.deboundedRebuildFuseSearchIndex();
  }

  rebuildFuseSearchIndex() {
    // Rebuild the fuse search index with the current searchable data.
    this.fuseSearch = new Fuse(this.searchableData, {
      keys: ["key", "title", "authors", "year"],
      threshold: 0.3,
    });

    // Invoke the callbacks for all search queries with the new search results.
    this.listenersSearch.forEach((callbacks, query) => {
      const results = this.fuseSearch!.search(query).map(
        (result) => result.item.key
      );
      callbacks.forEach((cb) => cb(results));
    });
  }

  /**
   * This function is a debounced version of the rebuildFuseSearchIndex function. It will delay the execution of the rebuildFuseSearchIndex function until after 1000 milliseconds have elapsed since the last time it was invoked.
   */
  deboundedRebuildFuseSearchIndex = debounce(
    this.rebuildFuseSearchIndex.bind(this),
    1000
  );

  /**
   * This function allows components to subscribe to search results for a specific query.
   *
   * Note that the search results are also immediately sent to the callback if the fuseSearch index is already built.
   */
  subscribeSearch(
    query: string,
    callback: (searchResult: Array<string>) => void
  ): () => void {
    if (!this.listenersSearch.has(query)) {
      this.listenersSearch.set(query, new Set());
    }
    this.listenersSearch.get(query)!.add(callback);

    // Immediately send the results of the search query to the callback if the fuseSearch index is already built.
    if (this.fuseSearch !== null) {
      const results = this.fuseSearch
        .search(query)
        .map((result) => result.item.key);
      callback(results);
    } else {
      this.deboundedRebuildFuseSearchIndex();
    }

    // Return unsubscribe function
    return () => this.listenersSearch.get(query)!.delete(callback);
  }

  // Functions to manage individual items.

  /**
   * This function retrieves an item by name.
   *
   * It first checks the local database for the item. If the item is not found, it requests an update via WebSocket and rejects the promise.
   * @param key The name of the item to retrieve.
   */
  retrieve(key: string): Promise<Item> {
    // Implementation to request an HTMLResult by name
    return new Promise((resolve, reject) => {
      // First we check for an existing item in the database
      getItem(this.base.name, key)
        .then((item) => {
          if (item) {
            resolve(item);
          } else {
            // Item not found, proceed to request via WebSocket
            this.requestUpdate(key);
            reject();
          }
        })
        .catch(() => {
          this.requestUpdate(key);
          reject();
        });
    });
  }

  /**
   * This function allows components to subscribe to updates for a specific item by name.
   *
   * @param name The name of the item to subscribe to.
   */
  subscribe(name: string, callback: (result: Item) => void): () => void {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, new Set());
    }
    this.listeners.get(name)!.add(callback);

    // Ensure that the callback is called with the current item if it exists in the database, or request an update via WebSocket if it does not exist.
    this.retrieve(name)
      .then(callback)
      .catch(() => {});

    // Return unsubscribe function
    return () => this.listeners.get(name)!.delete(callback);
  }

  /**
   * This function retrieves the keys to the top-level items, i.e., the non-constituents, for the base.
   *
   * As non-constituents are always requested in full via the websocket, this function will eventually return all
   * non-constituent keys.
   */
  retrieveNonConstituents(): Promise<string[]> {
    return getNonConstituents(this.base.name);
  }

  /**
   * This is the callback function that is called when the graph is updated. It informs all global callbacks about the new graph.
   *
   * It is passed to running graph managers so that they can inform the BaseManager when the graph is updated.
   */
  graphCallbackFunction(graph: Graph) {
    // Inform all global callbacks about the new graph
    this.listenersGlobal.forEach((cb) => cb(graph));
  }

  /**
   * This function allows components to subscribe to updates for any item in the base.
   */
  subscribeGlobal(callback: (result: Graph) => void): () => void {
    this.listenersGlobal.add(callback);

    // Send current version of the graph to the callback if it exists
    if (this.graphManager) {
      this.graphManager.getGraph().then(callback).catch(console.error);
    }

    // Return unsubscribe function
    return () => this.listenersGlobal.delete(callback);
  }

  /**
   * This function allows components to subscribe to the connection status of the WebSocket.
   */
  subscribeConnectionStatus(
    callback: (connected: boolean) => void
  ): () => void {
    this.listenersConnectionStatus.add(callback);

    callback(this.isConnected());

    // Return unsubscribe function
    return () => this.listenersConnectionStatus.delete(callback);
  }

  /**
   * This function retrieves the current graph from the ELKManager.
   *
   * @returns A promise that resolves to the current graph.
   */
  retrieveGraph(): Promise<Graph> {
    return (
      this.graphManager?.getGraph() ??
      Promise.reject("Graph Manager not initialized")
    );
  }

  /**
   * Obtain the URL for an asset that stems from this base.
   *
   * @param assetType The type of the asset (pdf, html, or video).
   * @param key The key of the item that the asset belongs to.
   * @param asset The asset object, which can be either "Local" or a remote URL.
   */
  async retrieveAssetURL(
    assetType: "pdf" | "html" | "video",
    key: string,
    asset: ItemAsset
  ): Promise<string | null> {
    if (asset === "Local") {
      let url = "";
      if (this.base.tls) {
        url = `https://${this.base.domain}:${this.base.port}/items/${key}/${assetType}`;
      } else {
        url = `http://${this.base.domain}:${this.base.port}/items/${key}/${assetType}`;
      }
      const headers = new Headers({
        "Content-Type": "application/json",
      });

      if (this.base.jwt) {
        headers.set("Authorization", `Bearer ${this.base.jwt}`);
      }
      const response = await fetch(url, {
        method: "GET",
        headers,
        credentials: "include",
      });
      if (!response.ok) {
        console.error(`Request failed: ${response.status}`);
        return null;
      }

      const serverPath = await response.json();

      if (this.base.tls) {
        return `https://${this.base.domain}:${this.base.port}${serverPath}`;
      } else {
        return `http://${this.base.domain}:${this.base.port}${serverPath}`;
      }
    }
    if ("Remote" in asset) {
      return asset.Remote;
    }
    return "";
  }
}

/**
 * React context for the BaseManager. This allows components to access the BaseManager instance without prop drilling.
 */
export const BaseManagerContext = createContext<BaseManager | null>(null);
