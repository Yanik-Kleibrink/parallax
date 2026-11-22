/**
 * This file contains the component that provides the remote control to the app (see remote-control.ts).
 */

import {
  RemoteControl,
  RemoteControlContext,
  remoteParams,
} from "./remote-control";

import { useEffect, useState, type JSX, type ReactNode } from "react";
import { useMatches, useNavigate } from "react-router";

/**
 * This component provides the remote control to the app (around <Outlet /> in root.tsx) and keeps it informed about the address.
 *
 * It creates the remote control once (which has no side effects) and starts it in an effect and stops it in the cleanup, so that StrictMode's second run of either leaves one connection.
 * @param children The app.
 */
export function RemoteControlProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [remote] = useState(() => new RemoteControl(remoteParams()));
  const matches = useMatches();
  const params = matches[matches.length - 1]?.params ?? {};
  const navigate = useNavigate();

  useEffect(() => {
    remote.start();
    return () => remote.stop();
  }, [remote]);

  // The parameters of the matched routes (routes.ts), so that pages like "add", "reconnect", or "invite" are not taken for a base or an item.
  const { base = null, node = null, assetParam: asset = null } = params;
  useEffect(() => {
    remote.setRoute({ base, node, asset }, navigate);
  }, [remote, base, node, asset, navigate]);

  return <RemoteControlContext value={remote}>{children}</RemoteControlContext>;
}
