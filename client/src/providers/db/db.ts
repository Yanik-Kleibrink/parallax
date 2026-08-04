/**
 * This file contains functions to interact with the IndexedDB database that is used to cache the items if the server is offline.
 */

import type { Base, Item, ItemFreshness } from "@/models";

const DB_NAME = "parallax";
const DB_VERSION = 7;
const ITEMS_STORE_NAME = "items";
const BASES_STORE_NAME = "bases";
const POSITIONS_STORE_NAME = "positions";
const IS_CONSTITUENT_INDEX = "isConstituentIndex";
const BASE_ITEMS_INDEX = "baseIndex";

// These are the values for booleans stored in the database, since IndexedDB does not support boolean values directly.
const TRUE = 1;
const FALSE = 0;

/**
 * A cached version of the database connection.
 */
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open a connection to the indexedDB database. If the database does not exist, it will be created.
 */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise !== null) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(ITEMS_STORE_NAME)) {
        db.deleteObjectStore(ITEMS_STORE_NAME);
        console.log("Object store deleted!");
      }
      db.createObjectStore(ITEMS_STORE_NAME, {
        keyPath: ["base", "item.key"],
      });
      if (db.objectStoreNames.contains(BASES_STORE_NAME)) {
        db.deleteObjectStore(BASES_STORE_NAME);
      }
      db.createObjectStore(BASES_STORE_NAME, { keyPath: "name" });
      if (db.objectStoreNames.contains(POSITIONS_STORE_NAME)) {
        db.deleteObjectStore(POSITIONS_STORE_NAME);
      }
      db.createObjectStore(POSITIONS_STORE_NAME, {
        keyPath: "base",
      });

      const itemStore = request.transaction!.objectStore(ITEMS_STORE_NAME);

      // Create flavor index if it doesn't exist
      if (!itemStore.indexNames.contains(IS_CONSTITUENT_INDEX)) {
        itemStore.createIndex(IS_CONSTITUENT_INDEX, ["base", "isConstituent"], {
          unique: false,
        });
      }

      // Create base index if it doesn't exist
      if (!itemStore.indexNames.contains(BASE_ITEMS_INDEX)) {
        itemStore.createIndex(BASE_ITEMS_INDEX, "base", {
          unique: false,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

/**
 * Add an item to the indexedDB database.
 * @param base The base name of the item.
 * @param item The item to add.
 */
export async function addItem(base: string, item: Item) {
  //    console.info("Adding item to DB:", base, item.key);
  const db = await openDB();
  const tx = db.transaction(ITEMS_STORE_NAME, "readwrite");
  tx.objectStore(ITEMS_STORE_NAME).put({
    base: base,
    item: item,
    isConstituent: item.flavor === "Constituent" ? TRUE : FALSE,
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Get an item from the indexedDB database.
 * @param base The base name of the item.
 * @param key The key of the item.
 */
export async function getItem(base: string, key: string): Promise<Item> {
  const db = await openDB();
  console.debug("Getting item from DB:", base, key);
  return new Promise<Item>((resolve, reject) => {
    const request = db
      .transaction(ITEMS_STORE_NAME)
      .objectStore(ITEMS_STORE_NAME)
      .get([base, key]);

    request.onsuccess = () =>
      request.result
        ? resolve(request.result.item as Item)
        : reject(request.error);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove an item from the indexedDB database.
 * @param base The base name of the item.
 * @param key The key of the item.
 */
export async function removeItem(base: string, key: string) {
  const db = await openDB();
  const tx = db.transaction(ITEMS_STORE_NAME, "readwrite");
  tx.objectStore(ITEMS_STORE_NAME).delete([base, key]);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// TODO: Make this more efficient
/**
 * Get the keys of all non-constituent items from the indexedDB database.
 * @param base The base name of the items.
 */
export async function getNonConstituents(base: string): Promise<string[]> {
  const db = await openDB();
  return new Promise<string[]>((resolve, reject) => {
    let query;
    try {
      query = IDBKeyRange.only([base, FALSE]);
    } catch (e) {
      console.error("Error creating IDBKeyRange:", e);
      reject(e);
      return;
    }

    //const query = IDBKeyRange.only([base, "top"]);
    const request = db
      .transaction(ITEMS_STORE_NAME)
      .objectStore(ITEMS_STORE_NAME)
      .index(IS_CONSTITUENT_INDEX)
      .openCursor(query);

    const results: string[] = [];
    request.onsuccess = () => {
      const cursor = request.result; //e.target.result;
      if (cursor) {
        results.push((cursor.primaryKey as [string, string])[1]);
        cursor.continue();
      } else resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove all items from the indexedDB database for a given base.
 * @param base The base name of the items.
 */
export async function removeAllItems(base: string) {
  const db = await openDB();
  const tx = db.transaction(ITEMS_STORE_NAME, "readwrite");
  const index = tx.objectStore(ITEMS_STORE_NAME).index(BASE_ITEMS_INDEX);
  const range = IDBKeyRange.only(base);

  index.openCursor(range).onsuccess = (e) => {
    const cursor = (e.target as IDBRequest).result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
}

/**
 * Get the freshness of all items from the indexedDB database.
 *
 * @param base The base name of the items.
 */
export async function getAllItemFreshness(
  base: string
): Promise<ItemFreshness[]> {
  const db = await openDB();
  return new Promise<ItemFreshness[]>((resolve, reject) => {
    const request = db
      .transaction(ITEMS_STORE_NAME)
      .objectStore(ITEMS_STORE_NAME)
      .index(BASE_ITEMS_INDEX)
      .openCursor(IDBKeyRange.only(base));

    const results: ItemFreshness[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const { item } = cursor.value;
        results.push({
          key: item.key,
          hash: item.hash,
          flavor: item.flavor,
        });
        cursor.continue();
      } else resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Add a base to the indexedDB database.
 *
 * @param base The base to add.
 */
export async function addBase(base: Base) {
  console.log(base);
  const db = await openDB();
  const tx = db.transaction(BASES_STORE_NAME, "readwrite");
  tx.objectStore(BASES_STORE_NAME).put(base);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 *   This function updates the lastConnected timestamp of a base in the indexedDB database.
 *
 *   It should be called whenever a base is connected to, to keep track of the last time it was accessed.
 */
export async function connectedToBase(base: string, configHash: number) {
  const db = await openDB();
  const tx = db.transaction(BASES_STORE_NAME, "readwrite");
  const store = tx.objectStore(BASES_STORE_NAME);
  const request = store.get(base);

  request.onsuccess = () => {
    const existingBase = request.result as Base;
    if (existingBase) {
      existingBase.lastConnected = Date.now();
      existingBase.configHash = configHash;
      store.put(existingBase);
    }
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Get a base from the indexedDB database.
 * @param base The base name to get.
 */
export async function getBase(base: string): Promise<Base> {
  const db = await openDB();
  return new Promise<Base>((resolve, reject) => {
    const request = db
      .transaction(BASES_STORE_NAME)
      .objectStore(BASES_STORE_NAME)
      .get(base);

    request.onsuccess = () => resolve(request.result as Base);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all bases from the indexedDB database.
 */
export async function getBases(): Promise<Base[]> {
  const db = await openDB();
  return new Promise<Base[]>((resolve, reject) => {
    const request = db
      .transaction(BASES_STORE_NAME)
      .objectStore(BASES_STORE_NAME)
      .getAll();

    request.onsuccess = () => resolve(request.result as Base[]);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get the cached positions for a base from the indexedDB database.
 * @param base The base name to get the cached positions for.
 */
export async function getCachedPositions(
  base: string
): Promise<[Record<string, { x: number; y: number }>, number]> {
  const db = await openDB();
  return new Promise<[Record<string, { x: number; y: number }>, number]>(
    (resolve, reject) => {
      const request = db
        .transaction(POSITIONS_STORE_NAME)
        .objectStore(POSITIONS_STORE_NAME)
        .get(base);

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          resolve([result.positions, result.timestamp]);
        } else {
          resolve([{}, 0]);
        }
      };
      request.onerror = () => reject(request.error);
    }
  );
}

/**
 * Set the cached positions for a base in the indexedDB database.
 * @param base The base name to set the cached positions for.
 * @param positions The positions to set.
 */
export async function setCachedPositions(
  base: string,
  positions: Record<string, { x: number; y: number }>
) {
  const db = await openDB();
  const tx = db.transaction(POSITIONS_STORE_NAME, "readwrite");
  tx.objectStore(POSITIONS_STORE_NAME).put({
    base: base,
    timestamp: Date.now(),
    positions: positions,
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * A function to remove all objects associated with the provided name.
 *
 * @param name the name of the base to remove.
 */
export async function removeBase(name: string) {
  const db = await openDB();

  const tx = db.transaction(
    [ITEMS_STORE_NAME, BASES_STORE_NAME, POSITIONS_STORE_NAME],
    "readwrite"
  );

  // Remove items belonging to the base
  const index = tx.objectStore(ITEMS_STORE_NAME).index(BASE_ITEMS_INDEX);

  const range = IDBKeyRange.only(name);

  index.openCursor(range).onsuccess = (e) => {
    const cursor = (e.target as IDBRequest).result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };

  // Remove the base
  tx.objectStore(BASES_STORE_NAME).delete(name);

  // Remove the position
  tx.objectStore(POSITIONS_STORE_NAME).delete(name);

  return new Promise<boolean>((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
