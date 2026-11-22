/**
 * This file contains the connection of a Parallax window to a remote control, which is a local program that can open items and emphasize TQFs over a WebSocket, and that learns where the window is and what the user reads.
 *
 * The primary purpose of the remote control is to allow the client to send information back to an editor that a user is using to modify the base.
 *
 * The window learns the remote control from the fragment of its address, as in /<base>/<node>#port=<remote control port>&name=<name>&token=<secret>. A fragment is never sent to the server that hosts the client, so the token stays on the device.
 * Parallax's own navigation drops the fragment, so the window keeps these parameters in its session storage (per tab) and reconnects after a reload without them.
 * Without a port, the remote control still exists and components subscribe to it as usual, but it has no WebSocket and no listeners.
 * The WebSocket connects to ws://127.0.0.1:<port>/?name=<name>&instance=<id>&token=<secret>, where the instance tells windows with the same name apart.
 * Currently, a remote control is only permitted on localhost, so the window never connects to another host, whatever its address says.
 * The token is a secret that the remote control should check, so that it does not accept connections from other programs.
 *
 * The remote control sends "open" (show an item, or the main page of the base without one) and "emphasize" (pulse a TQF).
 * "open" names the base by its ID (`id` in its config); the window opens the item in the stored base with that ID.
 * The window sends "state" (where it is, which section the user reads, the last input, focus, and visibility) on every connect and every change, and "dismiss" when the X of a TQF is clicked.
 * As the Parallax server never edits org files, the remote control removes a dismissed TQF, and the page updates through the base as usual.
 */

import type { Base } from "@/models";
import { getBases } from "@/providers/db";
import { NodeIDContext } from "@/providers/nodeID";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type RefCallback,
  type RefObject,
} from "react";

/**
 * This type represents a section on the path to the section that the user reads.
 *
 * The key is the server's key of the section, a hash of its raw title, which is not unique (sections with equal titles share it).
 * The title is the plain text of the title (see convertToString), which the remote control matches against the org file.
 */
export type SectionRef = { key: string; title: string };

/**
 * This type represents the state of a window that is sent to the remote control.
 */
type RemoteState = {
  /**
   * The base by its ID (null until the client has connected to its server), its name in this client, and its server (domain:port), never by its login token.
   */
  base: { id: string | null; name: string; server: string | null } | null;

  /**
   * The item in the address, or null on a page that is not an item.
   */
  node: string | null;

  /**
   * The asset in the address, if one is shown.
   */
  asset: string | null;

  /**
   * The item that the section the user reads belongs to (an included constituent has its own key).
   */
  item: string | null;

  /**
   * The section that the user reads in the main pane, with its enclosing sections, outermost first.
   */
  path: SectionRef[];

  /**
   * The time (ms since the epoch) of the last pointer, key, wheel, or touch input.
   */
  lastInput: number;

  /**
   * Whether the window has the focus.
   */
  focused: boolean;

  /**
   * Whether the window is visible.
   */
  visible: boolean;
};

/**
 * This type represents a message from the remote control.
 *
 * "open" shows an item by its key (without a key, the main page of the base) in the base with the given ID.
 * "emphasize" pulses a TQF for `ms` (default PULSE), also one that is rendered later within that time.
 */
type FromRemote =
  | { type: "open"; key?: string; base: string }
  | { type: "emphasize"; tqf: string; ms?: number };

/**
 * This type represents a message to the remote control.
 *
 * "state" carries the state of the window.
 * "dismiss" names a TQF whose X was clicked and the item that contains it.
 */
type ToRemote =
  | ({ type: "state" } & RemoteState)
  | { type: "dismiss"; tqf: string; item: string | null };

/**
 * The time (ms) that a change waits before the state is sent, which is also the shortest time between two states.
 */
const DELAY = 300;

/**
 * The delay (ms) before the first attempt to reconnect. It doubles with every failed attempt, as in BaseManager.
 */
const RECONNECT_BASE_DELAY = 1000;

/**
 * The longest delay (ms) between two attempts to reconnect.
 */
const RECONNECT_MAX_DELAY = 30000;

/**
 * The time (ms) that a TQF pulses if the remote control gives no time.
 */
const PULSE = 4000;

/**
 * The longest time (ms) that a TQF pulses, whatever the remote control asks for, so that a mistaken time does not leave it pulsing.
 */
const MAX_PULSE = 60000;

/**
 * The key under which the window keeps the parameters of its remote control in the session storage.
 */
const STORAGE_KEY = "parallax-remote-control";

/**
 * The parameters of the remote control of this window (port, name, and token), read once.
 */
let loadedParams: URLSearchParams | undefined;

/**
 * Get the parameters of the remote control of this window.
 *
 * They come from the fragment of the address the app was loaded with, which is then moved into the session storage. Without a fragment, they come from an earlier load of this tab.
 *
 * @returns The parameters (empty without a remote control, and outside a browser).
 */
export function remoteParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  if (loadedParams) return loadedParams;
  loadedParams = new URLSearchParams(window.location.hash.slice(1));
  try {
    if (remotePort(loadedParams) !== null) {
      sessionStorage.setItem(STORAGE_KEY, loadedParams.toString());
      // The token then leaves the address, so it stays out of the history.
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, "", pathname + search);
    } else {
      loadedParams = new URLSearchParams(
        sessionStorage.getItem(STORAGE_KEY) ?? ""
      );
    }
  } catch {
    // Without a session storage, the window has a remote control only while the address names it.
  }
  return loadedParams;
}

/**
 * Get the port of the remote control that parameters name.
 *
 * @param params The parameters of the remote control.
 * @returns The port, or null if they name no valid port.
 */
function remotePort(params: URLSearchParams): number | null {
  const port = Number(params.get("port"));
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/**
 * Get the title of a page.
 *
 * It is "Parallax", marked with "[RC]" if the window has a remote control (a port, whether or not its WebSocket is connected), and followed by the subtitle if there is one.
 *
 * @param subtitle The subtitle, e.g. the key of the item.
 * @returns The title, e.g. "Parallax [RC] — Key".
 */
export function pageTitle(subtitle?: string): string {
  const name =
    remotePort(remoteParams()) === null ? "Parallax" : "Parallax [RC]";
  return subtitle ? `${name} — ${subtitle}` : name;
}

/**
 * Convert a node ID into the key of its item, e.g. "Key.sub" into "Key".
 *
 * @param nodeID The node ID.
 * @returns The key of the item, or null without a node ID.
 */
function itemKey(nodeID: string | null): string | null {
  return nodeID?.split(".")[0] ?? null;
}

/**
 * Check a message from the remote control.
 *
 * @param data The data of the WebSocket message.
 * @returns The message, or null if it is not one that the window understands.
 */
function parseMessage(data: unknown): FromRemote | null {
  let message: unknown;
  try {
    message = JSON.parse(String(data));
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  const m = message as Record<string, unknown>;
  const optionalString = (value: unknown) =>
    value === undefined || typeof value === "string";
  if (
    m.type === "open" &&
    optionalString(m.key) &&
    typeof m.base === "string"
  ) {
    return m as FromRemote;
  }
  if (
    m.type === "emphasize" &&
    typeof m.tqf === "string" &&
    (m.ms === undefined ||
      (typeof m.ms === "number" && Number.isFinite(m.ms) && m.ms > 0))
  ) {
    return m as FromRemote;
  }
  return null;
}

/**
 * This class manages the WebSocket to the remote control. It carries out the remote control's messages and sends it the state of the window.
 */
export class RemoteControl {
  /**
   * The WebSocket to the remote control. This will be null before the first connection.
   */
  private ws: WebSocket | null = null;

  /**
   * The port of the remote control, or null without one.
   */
  private readonly port: number | null;

  /**
   * The query of the WebSocket's address, with the name and instance of the window and the token.
   */
  private readonly handshake: URLSearchParams;

  /**
   * Whether the WebSocket is open.
   */
  private connected = false;

  /**
   * The listeners for changes of the connection (see subscribeConnection).
   */
  private connectionListeners = new Set<() => void>();

  /**
   * The opens that the remote control asked for, one after the other, so that the last one wins even if an earlier one waits for the stored bases.
   */
  private opening: Promise<void> = Promise.resolve();

  /**
   * This removes all listeners and stops reconnecting on stop. It is null while the remote control is stopped.
   */
  private off: AbortController | null = null;

  /**
   * The number of failed attempts to reconnect since the last connection, for the exponential backoff.
   */
  private retryCount = 0;

  /**
   * The timer of the next attempt to reconnect, or null if none is pending.
   */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The timer of the next state to be sent, or null if none is pending.
   */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The last state that was sent, so that an unchanged state is not sent again.
   */
  private sent = "";

  /**
   * The base, the node, and the asset in the address.
   */
  private route: {
    base: string | null;
    node: string | null;
    asset: string | null;
  } = { base: null, node: null, asset: null };

  /**
   * The name, the ID, and the server (domain:port) of the base, set by InsideBase.
   */
  private base: { name: string; id: string | null; server: string } | null =
    null;

  /**
   * The router's navigate function, set by RemoteControlProvider.
   */
  private navigate: (path: string) => void = () => {};

  /**
   * The time (ms since the epoch) of the last pointer, key, wheel, or touch input.
   */
  private lastInput = 0;

  /**
   * A map of listeners for TQFs. The key is the TQF ID, and the value is a set of callback functions (one per rendered copy) that are called with the time until which the TQF pulses.
   */
  private tqfs = new Map<string, Set<(until: number) => void>>();

  /**
   * A map from TQF IDs to the time (ms since the epoch) until which they pulse, so that a TQF that is rendered later still pulses.
   */
  private pulses = new Map<string, number>();

  /**
   * A map of the headlines of the rendered sections to the item they belong to and their path.
   */
  private sections = new Map<
    HTMLElement,
    { item: string | null; path: SectionRef[] }
  >();

  /**
   * A map of the content areas (see NodeContent) to the node they show. The one that shows the node in the address is the main pane.
   */
  private roots = new Map<HTMLElement, string>();

  /**
   * Create the connection of a window to a remote control. It connects only once started.
   *
   * @param params The parameters of the remote control (see remoteParams), which are empty without one.
   */
  constructor(params: URLSearchParams) {
    this.port = remotePort(params);
    // Not crypto.randomUUID, which exists only in secure contexts (a client served over http from another host).
    this.handshake = new URLSearchParams({
      name: params.get("name") ?? "",
      instance: Math.random().toString(36).slice(2, 10),
      token: params.get("token") ?? "",
    });
  }

  /**
   * Whether the window has a remote control, i.e., whether there is a WebSocket.
   */
  get active(): boolean {
    return this.port !== null;
  }

  /**
   * Connect to the remote control and start listening to the window. Without a remote control, this does nothing.
   *
   * RemoteControlProvider starts the remote control in an effect and stops it in the cleanup, so StrictMode may start it again after a stop.
   */
  start() {
    if (this.port === null || this.off) return;
    const off = new AbortController();
    this.off = off;
    this.retryCount = 0;

    // Retry with exponential backoff, as BaseManager does, unless the remote control was stopped.
    const retry = () => {
      if (off.signal.aborted) return;
      const delay = Math.min(
        RECONNECT_BASE_DELAY * 2 ** this.retryCount,
        RECONNECT_MAX_DELAY
      );
      this.retryCount++;
      this.reconnectTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (off.signal.aborted) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(`ws://127.0.0.1:${this.port}/?${this.handshake}`);
      } catch (error) {
        // E.g. a browser that does not allow ws:// from an https page.
        console.error("The remote control is not reachable:", error);
        retry();
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        this.retryCount = 0;
        this.setConnected(true);
        // The remote control may have restarted, so the state is sent again even if it did not change.
        this.sent = "";
        this.update();
      };
      ws.onmessage = (event) => {
        const message = parseMessage(event.data);
        if (message) this.receive(message);
        else console.warn("The remote control sent an unknown message.");
      };
      ws.onclose = () => {
        // A connection closed by stop may close only after a restart has opened the next one.
        if (this.ws === ws) this.setConnected(false);
        retry();
      };
    };
    connect();

    // Scrolling does not count as input, as it may come from the page itself.
    const options = { passive: true, capture: true, signal: off.signal };
    const input = () => {
      this.lastInput = Date.now();
      this.update();
    };
    for (const event of ["pointerdown", "keydown", "wheel", "touchstart"]) {
      window.addEventListener(event, input, options);
    }
    for (const event of ["scroll", "resize", "focus", "blur"]) {
      window.addEventListener(event, () => this.update(), options);
    }
    document.addEventListener("visibilitychange", () => this.update(), options);
  }

  /**
   * Shut down the WebSocket connection and remove all listeners.
   */
  stop() {
    this.off?.abort();
    this.off = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
    this.setConnected(false);
  }

  /**
   * Set whether the WebSocket is open and tell the listeners if that changed.
   *
   * @param connected Whether the WebSocket is open.
   */
  private setConnected(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    this.connectionListeners.forEach((callback) => callback());
  }

  /**
   * Whether the WebSocket to the remote control is open.
   */
  isConnected = (): boolean => this.connected;

  /**
   * This function allows components to subscribe to the connection (e.g. via useSyncExternalStore with isConnected).
   *
   * @param callback The function that is called whenever the WebSocket opens or closes.
   * @returns The function that unsubscribes.
   */
  subscribeConnection = (callback: () => void): (() => void) => {
    this.connectionListeners.add(callback);
    return () => void this.connectionListeners.delete(callback);
  };

  /**
   * Send a message to the remote control if the WebSocket is open.
   *
   * @param message The message to send, as JSON.
   * @returns Whether it was sent.
   */
  private send(message: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(message);
    return true;
  }

  /**
   * Carry out a message from the remote control.
   *
   * @param message The message.
   */
  private receive(message: FromRemote) {
    if (message.type === "open") {
      const { key, base } = message;
      this.opening = this.opening
        .then(() => this.open(key, base))
        .catch((error) =>
          console.error("The remote control could not open an item:", error)
        );
    } else if (message.type === "emphasize") {
      const now = Date.now();
      const until = now + Math.min(message.ms ?? PULSE, MAX_PULSE);
      for (const [tqf, end] of this.pulses) {
        if (end <= now) this.pulses.delete(tqf);
      }
      this.pulses.set(message.tqf, until);
      this.tqfs.get(message.tqf)?.forEach((callback) => callback(until));
    }
  }

  /**
   * Send the state after a change, at most every DELAY, and only if it differs from the last one sent.
   */
  private update() {
    if (!this.off || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const state = JSON.stringify({
        type: "state",
        ...this.state(),
      } satisfies ToRemote);
      if (state !== this.sent && this.send(state)) this.sent = state;
    }, DELAY);
  }

  /**
   * Compute the state of the window.
   *
   * The section that the user reads is the one whose headline is the last above a line a third down the main pane.
   * Headlines in other panes and headlines that are not displayed do not count.
   *
   * @returns The state.
   */
  private state(): RemoteState {
    const { base, node, asset } = this.route;

    let best: { top: number; item: string | null; path: SectionRef[] } | null =
      null;
    // Only a NodeContent shows the node itself, also on the asset page "nodecontent".
    const root =
      node && (!asset || asset === "nodecontent")
        ? [...this.roots].find(([, shown]) => shown === node)?.[0]
        : undefined;
    if (root) {
      const area = root.getBoundingClientRect();
      const line = area.top + area.height / 3;
      for (const [headline, section] of this.sections) {
        if (!root.contains(headline)) continue;
        const rect = headline.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.top <= line && (!best || rect.top > best.top)) {
          best = { top: rect.top, ...section };
        }
      }
    }

    // The ID and the server only once they belong to the base in the address (not while the window switches bases).
    const known = this.base?.name === base ? this.base : null;
    return {
      base: base
        ? { id: known?.id ?? null, name: base, server: known?.server ?? null }
        : null,
      node,
      asset,
      item: best?.item ?? null,
      path: best?.path ?? [],
      lastInput: this.lastInput,
      focused: document.hasFocus(),
      visible: document.visibilityState === "visible",
    };
  }

  /**
   * Set the parts of the address and the router's navigate function (see RemoteControlProvider).
   *
   * @param route The base, the node, and the asset of the current route (null where the route has none, e.g. no node on the base's own pages).
   * @param navigate The function that shows a path.
   */
  setRoute(
    route: { base: string | null; node: string | null; asset: string | null },
    navigate: (path: string) => void
  ) {
    this.route = route;
    this.navigate = navigate;
    this.update();
  }

  /**
   * Open an item, or the main page of the base, in the base with the given ID.
   *
   * @param key The key of the item, or undefined for the main page of the base.
   * @param baseID The ID of the base.
   */
  private async open(key: string | undefined, baseID: string) {
    // The stored bases, not the base the window shows, as that may be stale while the window switches bases.
    // If several stored bases have the ID, the window stays in the one it shows.
    const bases = (await getBases()).filter((base) => base.id === baseID);
    const name = (
      bases.find((base) => base.name === this.route.base) ?? bases[0]
    )?.name;
    if (!name) {
      console.warn(`The remote control named an unknown base: ${baseID}`);
      return;
    }
    const item = key === undefined ? "" : `/${encodeURIComponent(key)}`;
    this.navigate(`/${encodeURIComponent(name)}${item}`);
  }

  /**
   * Set the base whose ID and server the state names (see InsideBase).
   *
   * @param base The base, or null outside a base.
   */
  setBase(base: Base | null) {
    this.base = base
      ? {
          name: base.name,
          id: base.id ?? null,
          server: `${base.domain}:${base.port}`,
        }
      : null;
    this.update();
  }

  /**
   * This function allows a TQF to subscribe to the remote control's emphasis. A pending emphasis is passed on at once.
   *
   * @param id The ID of the TQF.
   * @param callback The function that is called with the time (ms since the epoch) until which the TQF pulses.
   * @returns The function that unsubscribes.
   */
  subscribeTQF(id: string, callback: (until: number) => void): () => void {
    if (!this.active) return () => {};
    const callbacks = this.tqfs.get(id) ?? new Set();
    this.tqfs.set(id, callbacks.add(callback));
    const until = this.pulses.get(id) ?? 0;
    if (until > Date.now()) callback(until);
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) this.tqfs.delete(id);
    };
  }

  /**
   * Tell the remote control that the user dismissed a TQF.
   *
   * @param tqf The ID of the TQF.
   * @param item The key of the item that contains the TQF.
   */
  dismiss(tqf: string, item: string | null) {
    const message: ToRemote = { type: "dismiss", tqf, item };
    if (!this.send(JSON.stringify(message))) {
      console.warn("The remote control is not connected; the TQF stays.");
    }
  }

  /**
   * Register the headline of a rendered section.
   *
   * @param headline The headline.
   * @param section The item and the path of the section.
   * @returns The function that unregisters the headline.
   */
  registerSection(
    headline: HTMLElement,
    section: { item: string | null; path: SectionRef[] }
  ): () => void {
    if (!this.active) return () => {};
    this.sections.set(headline, section);
    this.update();
    return () => {
      this.sections.delete(headline);
      this.update();
    };
  }

  /**
   * Register a content area (see NodeContent).
   *
   * @param root The content area.
   * @param nodeID The node that it shows.
   * @returns The function that unregisters the content area.
   */
  registerRoot(root: HTMLElement, nodeID: string): () => void {
    if (!this.active) return () => {};
    this.roots.set(root, nodeID);
    this.update();
    return () => {
      this.roots.delete(root);
      this.update();
    };
  }
}

/**
 * Used to pass the connection to the remote control to the components. Outside RemoteControlProvider, it has no remote control.
 */
export const RemoteControlContext = createContext<RemoteControl>(
  new RemoteControl(new URLSearchParams())
);

/**
 * Used to pass the path of the enclosing sections, outermost first, to the sections inside them.
 */
export const SectionContext = createContext<SectionRef[]>([]);

/**
 * This hook connects a TQF to the remote control.
 *
 * While it pulses, the card adds a class, and the stack around it pulses with it (via :has in TQFStack.scss).
 * @param id The ID of the TQF, or null if it has none.
 * @returns Whether the TQF pulses, whether it shows the X (only while the remote control is connected), and the function that dismisses it.
 */
export function useRemoteTQF(id: string | null): {
  pulsing: boolean;
  dismissible: boolean;
  dismiss: () => void;
} {
  const remote = useContext(RemoteControlContext);
  const item = itemKey(useContext(NodeIDContext));
  const [pulsing, setPulsing] = useState(false);
  const connected = useSyncExternalStore(
    remote.subscribeConnection,
    remote.isConnected,
    () => false
  );

  useEffect(() => {
    if (!id) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = remote.subscribeTQF(id, (until) => {
      setPulsing(true);
      clearTimeout(timer);
      timer = setTimeout(() => setPulsing(false), until - Date.now());
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
      setPulsing(false);
    };
  }, [remote, id]);

  return {
    pulsing,
    dismissible: !!id && connected,
    dismiss: () => id && remote.dismiss(id, item),
  };
}

/**
 * The path of no sections, e.g. at the top of a constituent. It is one array, so that the sections below it keep their paths across renders.
 */
export const NO_SECTIONS: SectionRef[] = [];

/**
 * This hook registers the headline of a section with the remote control.
 *
 * The headline is registered by a callback ref, so that a new headline element (e.g. of another level) is registered in place of the old one.
 * @param key The key of the section.
 * @param title The plain text of its title (see convertToString).
 * @returns The path of the section, which the section passes to its contents via SectionContext, and the ref of the headline.
 */
export function useRemoteSection(
  key: string,
  title: string
): { path: SectionRef[]; headlineRef: RefCallback<HTMLElement> } {
  const remote = useContext(RemoteControlContext);
  const item = itemKey(useContext(NodeIDContext));
  const parent = useContext(SectionContext);
  const path = useMemo(() => [...parent, { key, title }], [parent, key, title]);
  const headlineRef = useCallback(
    (headline: HTMLElement | null) =>
      headline ? remote.registerSection(headline, { item, path }) : undefined,
    [remote, item, path]
  );

  return { path, headlineRef };
}

/**
 * This hook registers the content area of a NodeContent with the remote control. The one that shows the node in the address is the main pane.
 *
 * @param nodeID The node that the content area shows.
 * @param ref The content area.
 */
export function useRemoteScrollRoot(
  nodeID: string,
  ref: RefObject<HTMLElement | null>
) {
  const remote = useContext(RemoteControlContext);

  useEffect(() => {
    if (!ref.current) return;
    return remote.registerRoot(ref.current, nodeID);
  }, [remote, nodeID, ref]);
}
