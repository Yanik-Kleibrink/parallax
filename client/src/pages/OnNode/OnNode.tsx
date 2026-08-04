import { Sidebar, NodeView } from "@/components";
import { BaseManagerContext } from "@/providers";

import { useParams, useNavigate } from "react-router";
import { useState, useEffect, useContext } from "react";
import { ArrowsAngleExpand } from "react-bootstrap-icons";

import "./OnNode.scss";

export default function OnNode() {
  const [layout, setLayout] = useState<"vertical" | "horizontal">("horizontal");
  const [maxNumberOfOpenWindows, setMaxNumberOfOpenWindows] = useState(1);
  const [navigationState, setNavigationState] = useState<"Open" | "Minimized">(
    "Open"
  );
  const [nodePreviewFunction, setNodePreviewFunction] = useState<
    ((nodeID: string) => void) | undefined
  >(undefined);
  const [modalNode, setModalNode] = useState<string | null>(null);

  const { node } = useParams<{ node: string }>();
  const navigate = useNavigate();
  const baseManager = useContext(BaseManagerContext);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const query250 = window.matchMedia("(min-width: 250ch)");
    const query150 = window.matchMedia("(min-width: 150ch)");

    const updateLayout = () => {
      if (query250.matches) {
        setLayout("horizontal");
        setMaxNumberOfOpenWindows(2);
      } else if (query150.matches) {
        setLayout("horizontal");
        setMaxNumberOfOpenWindows(1);
      } else {
        setLayout("vertical");
        setMaxNumberOfOpenWindows(1);
        setNavigationState("Minimized");
      }
    };

    // Initial sync
    updateLayout();

    query250.addEventListener("change", updateLayout);
    query150.addEventListener("change", updateLayout);

    return () => {
      query250.removeEventListener("change", updateLayout);
      query150.removeEventListener("change", updateLayout);
    };
  }, [setLayout, setMaxNumberOfOpenWindows, setNavigationState]);

  useEffect(() => {
    if (!baseManager) return;
    if (layout === "vertical") {
      setNodePreviewFunction(() => (nodeID: string) => {
        navigate(`/${baseManager.getName()}/${nodeID}`);
      });
    } else {
      setNodePreviewFunction(() => (nodeID: string) => setModalNode(nodeID));
    }
  }, [layout, setNodePreviewFunction, setModalNode, baseManager, navigate]);

  return (
    <div
      className={["on-node-container", `on-node-container--${layout}`].join(
        " "
      )}
    >
      {layout === "horizontal" && (
        <div
          className={[
            "on-node-container__sidebar",
            navigationState === "Minimized" &&
              "on-node-container__sidebar--minimized",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <Sidebar
            defaultNode={node!}
            minimized={navigationState === "Minimized"}
            setMinimized={(minimized: boolean) =>
              setNavigationState(minimized ? "Minimized" : "Open")
            }
            layout={layout}
          />
        </div>
      )}
      <NodeView
        nodeID={node!}
        layout={layout}
        maxOpenWindows={maxNumberOfOpenWindows}
        showNavigationButton={layout === "vertical"}
        nodePreviewFunction={nodePreviewFunction}
      />

      {layout === "horizontal" && modalNode && (
        <div
          className="on-node-container__modal__container"
          onClick={() => {
            // Only events that click on the container and not the modal will reach here
            // as the other events are stopped by the modal.
            setModalNode(null);
          }}
        >
          <div
            className="on-node-container__modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <NodeView
              nodeID={modalNode}
              layout="horizontal"
              maxOpenWindows={maxNumberOfOpenWindows}
              showNavigationButton={false}
              nodePreviewFunction={nodePreviewFunction}
            />

            <button
              className="on-node-container__modal__pin button button--round"
              onClick={() => {
                setModalNode(null);
                navigate(`/${baseManager?.getName()}/${modalNode}`);
              }}
            >
              <ArrowsAngleExpand />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
