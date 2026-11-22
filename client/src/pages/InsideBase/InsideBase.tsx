import {
  BaseManager,
  BaseManagerContext,
  getBase,
  RemoteControlContext,
} from "@/providers";

import { useContext, useEffect, useState } from "react";
import { Outlet } from "react-router";
import { useParams } from "react-router";

import "./InsideBase.scss";

export default function InsideBase() {
  const { base } = useParams<{ base: string }>();
  console.log("Base component params:", base);

  const [baseManager, setBaseManager] = useState<BaseManager | null>(null);
  const remote = useContext(RemoteControlContext);

  useEffect(() => {
    if (!base) return;

    getBase(base).then((baseObject) => {
      console.log("Base is changed:", baseObject);
      console.log("Rendering Base component with base:", baseObject);
      console.log("Creating BaseManager");
      setBaseManager((oldBaseManager) => {
        oldBaseManager?.dispose();
        return new BaseManager(baseObject);
      });
    });
  }, [base]);

  // The remote control names the base by its ID and server as well, and forgets it when the window leaves the base.
  useEffect(() => {
    if (!baseManager) return;
    const unsubscribe = baseManager.subscribeBase((base) =>
      remote.setBase(base)
    );
    return () => {
      unsubscribe();
      remote.setBase(null);
    };
  }, [remote, baseManager]);

  return (
    <BaseManagerContext value={baseManager}>
      <Outlet />
    </BaseManagerContext>
  );
}
