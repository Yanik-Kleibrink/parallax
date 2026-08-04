import { BaseManager, BaseManagerContext, getBase } from "@/providers";

import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import { useParams } from "react-router";

import "./InsideBase.scss";

export default function InsideBase() {
  const { base } = useParams<{ base: string }>();
  console.log("Base component params:", base);

  const [baseManager, setBaseManager] = useState<BaseManager | null>(null);

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
  return (
    <BaseManagerContext value={baseManager}>
      <Outlet />
    </BaseManagerContext>
  );
}
