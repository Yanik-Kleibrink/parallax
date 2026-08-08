import {
  NodeContent,
  NodeDetails,
  NodePDF,
  NodeHTML,
  NodeVideo,
} from "@/components";
import { getNode, checkContentEmpty } from "@/utils";
import { BaseManagerContext, NodeIDContext } from "@/providers";
import type { Item } from "@/models";

import { useState, useContext, useEffect, type JSX } from "react";
import {
  XLg,
  FullscreenExit,
  FilePdf,
  FilePlay,
  FiletypeHtml,
  LayoutTextSidebar,
  Compass,
  BodyText,
} from "react-bootstrap-icons";
import { useNavigate } from "react-router";

import "./NodeView.scss";

type WindowState = "Open" | "Minimized";

type WindowType = "NodeContent" | "PDF" | "HTML" | "Video";

const WINDOW_TYPES: WindowType[] = ["NodeContent", "PDF", "HTML", "Video"];

function getWindowIcon(windowType: WindowType): JSX.Element | null {
  switch (windowType) {
    case "PDF":
      return <FilePdf />;
    case "HTML":
      return <FiletypeHtml />;
    case "NodeContent":
      return <BodyText />;
    case "Video":
      return <FilePlay />;
    default:
      return null;
  }
}

/**
 * A context that tracks the state of the NodeView component, including open windows and their states.
 *
 * It intentionally does not track which of the windows are available so that the user has a consistent experience when switching between nodes.
 */
class NodeViewContext {
  /**
   * An array that tracks the currently open windows and their states.
   * Each entry is a tuple of the window type and its state (open or minimized).
   */
  openWindows: [WindowType, WindowState][] = [["NodeContent", "Open"]];

  /**
   * An array that tracks the order in which windows were last opened.
   */
  lastOpenedWindows: WindowType[] = ["NodeContent"];

  /**
   * The maximum number of windows that can be open at the same time.
   *
   * This should be computed by a base component that takes the available screen space into account.
   */
  maxOpenWindows: number = 2;

  /**
   * Determines whether minimized windows are enabled.
   * If set to false, windows will be closed instead of minimized when the limit is reached.
   */
  minimizedEnabled: boolean = true;

  constructor(maxOpenWindows: number = 2, minimizedEnabled: boolean = true) {
    this.maxOpenWindows = maxOpenWindows;
    this.minimizedEnabled = minimizedEnabled;

    // This is the case of a vertical layout.
    if (this.minimizedEnabled === false && this.maxOpenWindows == 1) {
      this.openWindows = [];
      this.lastOpenedWindows = [];
    }
  }

  /**
   * Minimizes a window of the specified type.
   *
   * If minimized windows are not enabled, the window will be closed instead.
   */
  minimizeWindow(windowType: WindowType) {
    const windowIndex = this.openWindows.findIndex(
      ([type]) => type === windowType
    );
    if (windowIndex !== -1) {
      if (this.minimizedEnabled) {
        this.openWindows[windowIndex][1] = "Minimized";
      } else {
        this.openWindows.splice(windowIndex, 1);
      }
    }
  }

  /**
   * Opens a window of the specified type.
   *
   * If too many windows are open, the least recently opened window will be minimized.
   */
  openWindow(windowType: WindowType) {
    const windowIndex = this.openWindows.findIndex(
      ([type]) => type === windowType
    );
    if (windowIndex !== -1) {
      this.openWindows[windowIndex][1] = "Open";
    } else {
      this.openWindows.unshift([windowType, "Open"]);
    }
    // Remove this window type from the lastOpenedWindows array if it already exists
    const existingIndex = this.lastOpenedWindows.indexOf(windowType);
    if (existingIndex !== -1) {
      this.lastOpenedWindows.splice(existingIndex, 1);
    }
    if (this.lastOpenedWindows.unshift(windowType) > this.maxOpenWindows) {
      this.minimizeWindow(this.lastOpenedWindows.pop()!);
    }
  }

  /**
   * Closes a window of the specified type.
   */
  closeWindow(windowType: WindowType) {
    const windowIndex = this.openWindows.findIndex(
      ([type]) => type === windowType
    );
    if (windowIndex !== -1) {
      this.openWindows.splice(windowIndex, 1);
    }
  }

  /**
   * Returns an array of window types that are currently closed (not open).
   *
   * Note that this does not yet take the available windows into account.
   */
  closedWindows(): WindowType[] {
    const allWindowTypes: WindowType[] = WINDOW_TYPES;
    return allWindowTypes.filter(
      (type) => !this.openWindows.some(([openType]) => openType === type)
    );
  }

  /**
   * Updates the maximum number of open windows and minimizes the least recently opened windows if necessary.
   */
  updateMaxOpenWindows(newMax: number) {
    this.maxOpenWindows = newMax;

    // If the number of open windows exceeds the new maximum, minimize the least recently opened windows
    while (this.openWindows.length > this.maxOpenWindows) {
      const leastRecentlyOpened = this.lastOpenedWindows.pop();
      if (leastRecentlyOpened) {
        this.minimizeWindow(leastRecentlyOpened);
      }
    }
  }

  /**
   * Updates the minimizedEnabled property and closes all minimized windows if minimized windows are disabled.
   */
  updateMinimizedEnabled(newValue: boolean) {
    this.minimizedEnabled = newValue;

    // If minimized windows are disabled, close all minimized windows
    if (!this.minimizedEnabled) {
      this.openWindows = this.openWindows.filter(
        ([, state]) => state === "Open"
      );
    }
  }

  /**
   * Closes all open windows and clears the last opened windows history.
   */
  closeAllWindows() {
    this.openWindows = [];
    this.lastOpenedWindows = [];
  }

  /**
   * Creates a deep copy of the current NodeViewContext instance.
   *
   * This is necessary when mutating the state.
   */
  clone(): NodeViewContext {
    const copy = new NodeViewContext();

    copy.openWindows = [...this.openWindows];
    copy.lastOpenedWindows = [...this.lastOpenedWindows];
    copy.maxOpenWindows = this.maxOpenWindows;
    copy.minimizedEnabled = this.minimizedEnabled;

    return copy;
  }
}

export function NodeView({
  nodeID,
  hash,
  setHash,
  layout = "horizontal",
  maxOpenWindows = 2,
  showNavigationButton = false,
  nodePreviewFunction,
}: {
  nodeID: string;
  hash?: string;
  setHash?: (hash: string | undefined) => void;
  layout?: "horizontal" | "vertical";
  maxOpenWindows: number;
  showNavigationButton?: boolean;
  nodePreviewFunction?: (nodeID: string) => void;
}) {
  const [nodeViewContext, setNodeViewContext] = useState<NodeViewContext>(
    () => {
      return new NodeViewContext(maxOpenWindows, layout === "horizontal");
    }
  );
  const [nodeDetailsState, setNodeDetailsState] = useState<
    "Open" | "Minimized"
  >("Minimized");
  // We intentionally do not track which of the windows are available in NodeViewContext so that the user has a consistent experience when switching between nodes.
  const [availableWindows, setAvailableWindows] = useState<Set<WindowType>>(
    new Set()
  );
  const [userInteracted, setUserInteracted] = useState(false);
  const [connected, setConnected] = useState<boolean>(false);

  const [pdfURL, setPDFURL] = useState<string | null>(null);
  const [htmlURL, setHTMLURL] = useState<string | null>(null);
  const [videoURL, setVideoURL] = useState<string | null>(null);

  const baseManager = useContext(BaseManagerContext);
  const navigate = useNavigate();

  const key = nodeID.split(".")[0];

  useEffect(() => {
    if (!baseManager) return;

    return baseManager.subscribeConnectionStatus(setConnected);
  }, [baseManager]);

  // This effect updates the window state when the layout changes or the nodeID changes.
  // It essentially sets the initial state of the windows based on the layout and the nodeID.
  useEffect(() => {
    setNodeViewContext((prevContext) => {
      const next = prevContext.clone();
      next.updateMaxOpenWindows(maxOpenWindows);
      next.updateMinimizedEnabled(layout === "horizontal");

      if (layout === "vertical") {
        next.closeAllWindows(); // Close all windows when switching to vertical layout and the details panel is open
      }
      return next;
    });

    if (layout === "vertical") {
      setNodeDetailsState("Open"); // Automatically open the details panel when switching to vertical layout
    }
  }, [nodeID, maxOpenWindows, layout, setNodeDetailsState, setNodeViewContext]);

  useEffect(() => {
    setUserInteracted(false); // Reset user interaction state when the nodeID changes
  }, [nodeID]);

  useEffect(() => {
    if (!baseManager) return;

    const updateAvailableWindows = async (item: Item) => {
      const node = getNode(nodeID, item);
      if (!node) {
        setAvailableWindows(new Set());
        return;
      }

      const windows = new Set<WindowType>();

      // TODO: Ensure that there are not too many updates here as
      // each retrieve will trigger a new request to the server.
      if (item.pdf) {
        baseManager
          .retrieveAssetURL("pdf", key, item.pdf)
          .then((url) => {
            setPDFURL(url);
          })
          .catch(() => setPDFURL(null));
      }
      if (item.html) {
        baseManager
          .retrieveAssetURL("html", key, item.html)
          .then((url) => {
            setHTMLURL(url);
          })
          .catch(() => setHTMLURL(null));
      }

      if (item.video) {
        baseManager
          .retrieveAssetURL("video", key, item.video)
          .then((url) => {
            setVideoURL(url);
          })
          .catch(() => setVideoURL(null));
      }

      if (item.pdf) {
        windows.add("PDF");
      }
      if (item.html) {
        windows.add("HTML");
      }
      if (item.video) {
        windows.add("Video");
      }

      // This ensures that the details panal is minimized when the table of contents is empty.
      if (!checkContentEmpty(node.content)) {
        windows.add("NodeContent");
      }

      if (!userInteracted) {
        setNodeDetailsState("Minimized"); // Default to minimized state
        if (windows.has("NodeContent")) {
          setNodeDetailsState("Open"); // Automatically open the NodeContent window if it has content
        }
      }

      setAvailableWindows(windows);
    };

    const unsubscribe = baseManager.subscribe(key, updateAvailableWindows);

    baseManager
      .retrieve(key)
      .then(updateAvailableWindows)
      .catch(() => {});

    return unsubscribe;
  }, [
    userInteracted,
    baseManager,
    nodeID,
    setAvailableWindows,
    setNodeDetailsState,
  ]);

  return (
    <NodeIDContext value={nodeID}>
      <div
        className={[
          "node-view__details",
          `node-view__details--${layout}`,
          nodeDetailsState === "Minimized" && "node-view__details--minimized",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={
          nodeDetailsState === "Minimized"
            ? () => {
                setUserInteracted(true);
                setNodeDetailsState("Open");
                if (layout === "vertical") {
                  setNodeViewContext((prevContext) => {
                    const next = prevContext.clone();
                    next.closeAllWindows(); // Close all windows when opening the details panel in vertical layout
                    return next;
                  });
                }
              }
            : undefined
        }
      >
        <NodeDetails
          nodeID={nodeID}
          openLink={(key) => {
            setUserInteracted(true);

            // Navigate is not used here as the custom scroll function in NodeContent will handle the scrolling to the section.
            setHash?.(`node-${key}`);
            setNodeViewContext((prevContext) => {
              const next = prevContext.clone();
              next.openWindow("NodeContent");

              if (layout === "vertical") {
                // Minimize the details panel when a window is opened in vertical layout
                setNodeDetailsState("Minimized");
              }

              return next;
            });
          }}
          collapsed={nodeDetailsState === "Minimized"}
        />

        {nodeDetailsState === "Minimized" && layout === "horizontal" && (
          <span className="node-view__details__minimized-indicator">
            <LayoutTextSidebar />
          </span>
        )}

        <div className="node-view__details__buttons">
          <div className="node-view__details__buttons__windows">
            {nodeViewContext
              .closedWindows()
              .filter((windowType) =>
                availableWindows.has(windowType as WindowType)
              )
              .map((windowType) => {
                const icon = getWindowIcon(windowType as WindowType);

                return (
                  <button
                    key={windowType}
                    className="node-view__details__buttons__windows__button button button--square"
                    disabled={!connected && windowType !== "NodeContent"} // Disable the button if not connected and the window type is not NodeContent
                    onClick={(event) => {
                      setUserInteracted(true);
                      setNodeViewContext((prevContext) => {
                        const next = prevContext.clone();
                        next.openWindow(windowType);

                        if (layout === "vertical") {
                          // Minimize the details panel when a window is opened in vertical layout
                          setNodeDetailsState("Minimized");
                        }
                        return next;
                      });
                      event.stopPropagation(); // Prevent the click from propagating to the parent div
                    }}
                  >
                    {icon}
                  </button>
                );
              })}
          </div>
          {nodeDetailsState === "Open" && layout === "horizontal" && (
            <div
              className="node-view__details__buttons__button button button--round"
              onClick={() => {
                setUserInteracted(true);
                setNodeDetailsState("Minimized");
              }}
            >
              <FullscreenExit />
            </div>
          )}
          {showNavigationButton && (
            <div
              className="node-view__details__to-navigation button button--round"
              onClick={(event) => {
                setUserInteracted(true);
                navigate(`/${baseManager?.getName()}`);
                event.stopPropagation();
              }}
            >
              <Compass />
            </div>
          )}
        </div>
      </div>

      {nodeViewContext.openWindows.some(([windowType]) =>
        availableWindows.has(windowType as WindowType)
      ) && <div className={["divider", `divider--${layout}`].join(" ")} />}
      {nodeViewContext.openWindows
        .filter(([windowType]) =>
          availableWindows.has(windowType as WindowType)
        )
        .map(([windowType, windowState], index) => {
          let content;
          switch (windowType) {
            case "NodeContent":
              content = (
                <NodeContent
                  nodeID={nodeID}
                  hash={hash}
                  setHash={setHash}
                  nodePreviewFunction={nodePreviewFunction}
                />
              );
              break;
            case "PDF":
              if (pdfURL) {
                content = <NodePDF url={pdfURL} />;
              }
              break;
            case "HTML":
              if (htmlURL) {
                content = <NodeHTML url={htmlURL} />;
              }
              break;
            case "Video":
              if (videoURL) {
                content = <NodeVideo url={videoURL} />;
              }
              break;
            default:
              content = null;
          }
          if (windowState === "Open") {
            return (
              <>
                <div
                  className={[
                    "node-view__content",
                    `node-view__content--${layout}`,
                  ].join(" ")}
                  key={index}
                >
                  <div className="node-view__content__wrapper">{content}</div>
                  {layout === "horizontal" && (
                    <div
                      className="node-view__content__button button button--round"
                      onClick={() => {
                        setUserInteracted(true);
                        setNodeViewContext((prevContext) => {
                          const next = prevContext.clone();
                          next.minimizeWindow(windowType);
                          return next;
                        });
                      }}
                    >
                      <FullscreenExit />
                    </div>
                  )}
                </div>
                {index < nodeViewContext.openWindows.length - 1 && (
                  <div className={`divider divider--${layout}`} />
                )}
              </>
            );
          } else if (windowState === "Minimized") {
            return (
              <>
                <div
                  key={index}
                  className={[
                    "node-view__content",
                    "node-view__content--minimized",
                    `node-view__content--${layout}`,
                  ].join(" ")}
                  onClick={() => {
                    setUserInteracted(true);
                    setNodeViewContext((prevContext) => {
                      const next = prevContext.clone();
                      next.openWindow(windowType);
                      return next;
                    });
                  }}
                >
                  <div className="node-view__content__wrapper">{content}</div>
                  <span className="node-view__content__minimized-indicator">
                    {getWindowIcon(windowType)}
                  </span>
                  {layout === "horizontal" && (
                    <div
                      className="node-view__content__button button button--round"
                      onClick={(event) => {
                        setUserInteracted(true);
                        setNodeViewContext((prevContext) => {
                          const next = prevContext.clone();
                          next.closeWindow(windowType);
                          return next;
                        });

                        event.stopPropagation(); // Prevent the click from propagating to the parent div
                      }}
                    >
                      <XLg />
                    </div>
                  )}
                </div>
                {index <
                  nodeViewContext.openWindows.filter(([windowType]) =>
                    availableWindows.has(windowType as WindowType)
                  ).length -
                    1 && (
                  <div
                    className={["divider", `divider--${layout}`].join(" ")}
                  />
                )}
              </>
            );
          }
          // Add other window types here if needed
        })}
    </NodeIDContext>
  );
}
