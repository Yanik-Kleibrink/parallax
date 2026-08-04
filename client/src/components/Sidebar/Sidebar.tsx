import { Navigation, BaseInformation } from "@/components";
import { BaseManagerContext } from "@/providers";

import {
  Compass,
  ArrowsAngleExpand,
  FullscreenExit,
} from "react-bootstrap-icons";
import { useState, useContext } from "react";
import { useNavigate } from "react-router";
import { Search, XLg } from "react-bootstrap-icons";

import "./Sidebar.scss";

/**
 * The sidebar (or topbar on mobile) component that contains the navigation as well as the base selector.
 *
 * The base selector should be overlaid on top of the navigation.
 */
export function Sidebar({
  defaultNode,
  minimized,
  setMinimized,
  layout,
}: {
  defaultNode: string | null;
  minimized: boolean;
  setMinimized: (minimized: boolean) => void;
  layout: "vertical" | "horizontal";
}) {
  const [previewActive, setPreviewActive] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const navigate = useNavigate();
  const baseManager = useContext(BaseManagerContext);

  return (
    <div
      className={[
        "sidebar-container",
        minimized && "sidebar-container--minimized",
        `sidebar-container--${layout}`,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        if (minimized) {
          setMinimized(false);
        }
      }}
    >
      {!minimized && (
        <div className="sidebar-container__base-information">
          <BaseInformation />
        </div>
      )}
      <Navigation
        defaultNode={defaultNode}
        searchQuery={searchQuery}
        setPreviewActive={setPreviewActive}
      />
      {!defaultNode && !previewActive && (
        <div className="sidebar-container__search">
          <Search />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")}>
              <XLg />
            </button>
          )}
        </div>
      )}

      {/* Don't show the buttons on the entry page where there is no default node. */}
      {!previewActive && !minimized && defaultNode && (
        <div className="sidebar-container__controls">
          <div
            className="button button--round"
            onClick={() => {
              setMinimized(true);
            }}
          >
            <FullscreenExit />
          </div>
          <div
            className="button button--round"
            onClick={(event) => {
              navigate(`/${baseManager?.getName()}`);
              event.stopPropagation();
            }}
          >
            <ArrowsAngleExpand />
          </div>
        </div>
      )}
      {minimized && (
        <div
          className="sidebar-container__overlay"
          onClick={(event) => {
            if (layout === "horizontal") {
              setMinimized(false);
            } else {
              navigate(`/${baseManager?.getName()}`);
            }
            event.stopPropagation();
          }}
        >
          <Compass />
        </div>
      )}
    </div>
  );
}
