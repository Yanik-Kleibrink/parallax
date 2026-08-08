import { createContext } from "react";

/**
 *   Used to pass a nodeID to the children.
 */
export const NodeIDContext = createContext<string | null>(null);
