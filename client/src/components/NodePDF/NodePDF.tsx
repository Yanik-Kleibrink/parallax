import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/react";
import { usePdfiumEngine } from "@embedpdf/engines/react";
import { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { useEffect, useRef, useState, type RefObject } from "react";

// Import the essential plugins
import {
  Viewport,
  ViewportPluginPackage,
} from "@embedpdf/plugin-viewport/react";
import {
  Scroller,
  ScrollPluginPackage,
  useScrollCapability,
} from "@embedpdf/plugin-scroll/react";
import {
  DocumentContent,
  DocumentManagerPluginPackage,
} from "@embedpdf/plugin-document-manager/react";
import {
  RenderLayer,
  RenderPluginPackage,
} from "@embedpdf/plugin-render/react";

import {
  useZoomCapability,
  ZoomGestureWrapper,
  ZoomMode,
  ZoomPluginPackage,
} from "@embedpdf/plugin-zoom/react";

import "./NodePDF.scss";

const plugins = [
  createPluginRegistration(DocumentManagerPluginPackage, {
    initialDocuments: [],
    maxDocuments: 1,
  }),
  createPluginRegistration(ViewportPluginPackage),
  createPluginRegistration(ScrollPluginPackage),
  createPluginRegistration(RenderPluginPackage),
  // A PDF starts at the width of its window. It must start in a mode: the viewport shows nothing until the zoom plugin has computed a mode once, which it never does for a fixed level.
  createPluginRegistration(ZoomPluginPackage, {
    defaultZoomLevel: ZoomMode.FitWidth,
  }),
];

/**
 * The share of a wheel step's zoom that reaches the zoom plugin.
 */
const WHEEL_ZOOM_SPEED = 1 / 3;

/**
 * Zooms with Ctrl (or Cmd) and minus, plus, or 0 (back to the width of the window) while the pointer is over the PDF, where the browser would zoom the whole page, and slows down zooming with Ctrl (or Cmd) and the wheel.
 *
 * The keys zoom the PDF whenever the pointer is over it, also while the focus is in a text field elsewhere.
 */
function ZoomKeys({
  documentId,
  area,
}: {
  documentId: string;
  area: RefObject<HTMLDivElement | null>;
}) {
  const { provides: zoomCapability } = useZoomCapability();

  useEffect(() => {
    if (!zoomCapability) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !area.current?.matches(":hover"))
        return;
      const zoom = zoomCapability.forDocument(documentId);
      if (event.key === "-") zoom.zoomOut();
      else if (event.key === "+" || event.key === "=") zoom.zoomIn();
      else if (event.key === "0") zoom.requestZoom(ZoomMode.FitWidth);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomCapability, documentId, area]);

  // EmbedPDF's wheel zoom is very aggressive for mouse wheels (about double or half the zoom per step), and it has no option for its speed, so a wheel zoom reaches it at a fraction of its strength (WHEEL_ZOOM_SPEED).
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.isTrusted) return;
      event.stopPropagation();
      event.preventDefault();
      event.target?.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          clientX: event.clientX,
          clientY: event.clientY,
          deltaMode: event.deltaMode,
          deltaY: event.deltaY * WHEEL_ZOOM_SPEED,
        })
      );
    };
    element.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
    return () =>
      element.removeEventListener("wheel", onWheel, { capture: true });
  }, [area]);

  return null;
}

/**
 * Opens a document in the EmbedPDF viewer using the Document Manager plugin.
 */
function OpenDocument({ url }: { url: string }) {
  const { provides: docManager } = useDocumentManagerCapability();

  useEffect(() => {
    if (!docManager || !url) return;

    docManager.openDocumentUrl({ url, autoActivate: true });
  }, [docManager, url]);

  return null;
}

/**
 * Scrolls to a page once the layout of the document is ready, and again for every new target.
 *
 * A scroll before the layout is ready is undone, as the layout then restores the stored offset.
 */
function GoToPage({
  documentId,
  target,
}: {
  documentId: string;
  target?: { page: number; key: string };
}) {
  const { provides: scroll } = useScrollCapability();
  const [readyDocument, setReadyDocument] = useState<string | null>(null);

  useEffect(() => {
    if (!scroll) return;
    return scroll.onLayoutReady((event) => setReadyDocument(event.documentId));
  }, [scroll]);

  useEffect(() => {
    if (!scroll || readyDocument !== documentId || !target) return;
    const documentScroll = scroll.forDocument(documentId);
    documentScroll.scrollToPage({
      pageNumber: Math.min(target.page, documentScroll.getTotalPages()),
      behavior: "instant",
    });
  }, [scroll, readyDocument, documentId, target]);

  return null;
}

/**
 * NodePDF component that renders a PDF document from a given URL using the EmbedPDF library.
 */
export function NodePDF({
  url,
  page,
}: {
  url: string;
  page?: { page: number; key: string };
}) {
  // 2. Initialize the engine with the React hook
  const { engine, isLoading } = usePdfiumEngine();
  // The area in which Ctrl with minus, plus, or 0 zooms the PDF (ZoomKeys).
  const area = useRef<HTMLDivElement>(null);

  if (isLoading || !engine) {
    return <div>Loading PDF Engine...</div>;
  }

  return (
    <div style={{ height: "100%" }} ref={area}>
      <EmbedPDF engine={engine} plugins={plugins}>
        {({ activeDocumentId }) => (
          <>
            <OpenDocument url={url} />
            {activeDocumentId && (
              <DocumentContent documentId={activeDocumentId}>
                {({ isLoaded }) =>
                  isLoaded && (
                    <>
                      <GoToPage documentId={activeDocumentId} target={page} />
                      <ZoomKeys documentId={activeDocumentId} area={area} />
                      <Viewport
                        documentId={activeDocumentId}
                        style={{
                          backgroundColor: "white",
                        }}
                      >
                        {/* Pinching and Ctrl (or Cmd) with the wheel zoom the PDF. */}
                        <ZoomGestureWrapper documentId={activeDocumentId}>
                          <Scroller
                            documentId={activeDocumentId}
                            renderPage={({ width, height, pageIndex }) => (
                              <div
                                style={{
                                  width,
                                  height,
                                }}
                              >
                                {/* The RenderLayer is responsible for drawing the page */}
                                <div className="node-pdf__render-layer">
                                  <RenderLayer
                                    documentId={activeDocumentId}
                                    pageIndex={pageIndex}
                                  />
                                </div>
                              </div>
                            )}
                          />
                        </ZoomGestureWrapper>
                      </Viewport>
                    </>
                  )
                }
              </DocumentContent>
            )}
          </>
        )}
      </EmbedPDF>
    </div>
  );
}
