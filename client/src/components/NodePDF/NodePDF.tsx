import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/react";
import { usePdfiumEngine } from "@embedpdf/engines/react";
import { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { useEffect } from "react";

// Import the essential plugins
import {
  Viewport,
  ViewportPluginPackage,
} from "@embedpdf/plugin-viewport/react";
import { Scroller, ScrollPluginPackage } from "@embedpdf/plugin-scroll/react";
import {
  DocumentContent,
  DocumentManagerPluginPackage,
} from "@embedpdf/plugin-document-manager/react";
import {
  RenderLayer,
  RenderPluginPackage,
} from "@embedpdf/plugin-render/react";

import "./NodePDF.scss";

const plugins = [
  createPluginRegistration(DocumentManagerPluginPackage, {
    initialDocuments: [],
    maxDocuments: 1,
  }),
  createPluginRegistration(ViewportPluginPackage),
  createPluginRegistration(ScrollPluginPackage),
  createPluginRegistration(RenderPluginPackage),
];

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
 * NodePDF component that renders a PDF document from a given URL using the EmbedPDF library.
 */
export function NodePDF({ url }: { url: string }) {
  // 2. Initialize the engine with the React hook
  const { engine, isLoading } = usePdfiumEngine();

  if (isLoading || !engine) {
    return <div>Loading PDF Engine...</div>;
  }

  return (
    <div style={{ height: "100%" }}>
      <EmbedPDF engine={engine} plugins={plugins}>
        {({ activeDocumentId }) => (
          <>
            <OpenDocument url={url} />
            {activeDocumentId && (
              <DocumentContent documentId={activeDocumentId}>
                {({ isLoaded }) =>
                  isLoaded && (
                    <Viewport
                      documentId={activeDocumentId}
                      style={{
                        backgroundColor: "white",
                      }}
                    >
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
                    </Viewport>
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
