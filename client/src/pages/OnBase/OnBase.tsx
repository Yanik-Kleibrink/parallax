import { Sidebar } from "@/components";

import "./OnBase.scss";

/**
 * OnBase.tsx
 * @description This is the main page for the OnBase application. It contains the navigation component and any other components that are needed for the application.
 * @returns {JSX.Element} The OnBase page component.
 */
export default function OnBase() {
  return (
    <div className="on-base-container">
      <Sidebar
        defaultNode={null}
        minimized={false}
        setMinimized={() => {}}
        layout={"horizontal"}
      />
      ;
    </div>
  );
}
