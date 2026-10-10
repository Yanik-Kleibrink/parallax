import type { ItemAsset } from "@/models";

import { NodeContent } from "@/components";

import { useParams } from "react-router";
import { useEffect, useContext } from "react";

import { BaseManagerContext } from "@/providers";

import "./OnAsset.scss";

export default function OnAsset() {
  const { node, assetParam } = useParams<{
    node: string;
    assetParam: string;
  }>();
  const baseManager = useContext(BaseManagerContext);

  if (!["html", "video", "nodecontent", "pdf"].includes(assetParam!)) {
    return <div>Unsupported asset type: {assetParam}</div>;
  }
  const asset = assetParam as "html" | "video" | "nodecontent" | "pdf";

  useEffect(() => {
    if (!baseManager || !node || !asset) return;

    baseManager.retrieve(node).then((item) => {
      let itemAsset: ItemAsset | null = null;
      if (asset === "pdf" && item.pdf) itemAsset = item.pdf;
      else if (asset === "html" && item.html) itemAsset = item.html;
      else if (asset === "video" && item.video) itemAsset = item.video;

      if (itemAsset) {
        baseManager
          .retrieveAssetURL(asset as "html" | "pdf" | "video", node, itemAsset)
          .then((url) => {
            if (url) {
              window.location.href = url!;
            }
          })
          .catch((error) => {
            console.error("Error retrieving asset URL:", error);
          });
      }
    });
  }, [baseManager, node, asset]);

  if (asset != "nodecontent") {
    return <div>Loading {asset}...</div>;
  }

  // Now, display the content.
  return (
    node && (
      <NodeContent
        nodeID={node}
        hash={undefined}
        setHash={(_: string | undefined) => {}}
        nodePreviewFunction={(_: string) => {}}
      />
    )
  );
}
