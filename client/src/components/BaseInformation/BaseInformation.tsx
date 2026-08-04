import { BaseManagerContext } from "@/providers";
import { BaseAutoIcon } from "@/components";

import { useContext, useEffect, useState } from "react";
import {
  Wifi,
  WifiOff,
  EnvelopeOpen,
  ArrowLeftRight,
} from "react-bootstrap-icons";
import { useNavigate } from "react-router";

import "./BaseInformation.scss";

/**
 *   BaseInformation component displays the current base information, including its name, group, and connection status. It also provides navigation options to switch bases or invite users if the base belongs to the "wheel" group.
 *
 */
export function BaseInformation() {
  const [connected, setConnected] = useState<boolean>(false);

  const baseManager = useContext(BaseManagerContext);
  const navigate = useNavigate();
  const base = baseManager ? baseManager.getBase() : null;

  useEffect(() => {
    if (!baseManager) return;

    return baseManager.subscribeConnectionStatus(setConnected);
  }, [baseManager]);

  return (
    <div className={["base-information"].filter(Boolean).join(" ")}>
      <div className="base-information__icon">
        <div
          className="base-information__icon__switcher button button--round"
          onClick={() => {
            navigate("/");
          }}
        >
          <ArrowLeftRight />
        </div>
        <div className="base-information__icon__background">
          <BaseAutoIcon baseName={base ? base.name : ""} />
        </div>
      </div>
      <div className="base-information__information">
        <div className="base-information__information__header">
          <span className="base-information__information__header__name">
            {base ? base.name : "No Base Selected"}
          </span>
          {"\u00A0"}
          <span className="base-information__information__header__group">
            {base ? `(${base.group})` : "No Group"}
          </span>
        </div>
        <div className="base-information__information__status">
          {connected ? (
            <>
              <Wifi />
              <span>Connected</span>
            </>
          ) : (
            <>
              <WifiOff />
              <span>Disconnected</span>
            </>
          )}
        </div>
      </div>
      {base && base.group === "wheel" && connected && (
        <div
          className="base-information__invite button button--round"
          onClick={() => {
            navigate(`/${base.name}/invite`);
          }}
        >
          <EnvelopeOpen />
        </div>
      )}
    </div>
  );
}
