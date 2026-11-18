import { useRef, type ReactNode } from "react";

import "./TQFStack.scss";
import { useTQFStackScroll } from "./TQFStackScroll";

/**
 * This component renders a run of consecutive TQFs as a stack.
 *
 * The stack fans out on hover or focus and can then be scrolled (see TQFStack.scss and TQFStackScroll.ts).
 * @param children The TQFs of the run.
 */
export function TQFStack({ children }: { children: ReactNode }) {
  const stackRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  useTQFStackScroll(stackRef, trackRef);

  return (
    <div ref={stackRef} className="structured-content__tqf-stack">
      <div ref={trackRef} className="structured-content__tqf-track">
        {children}
      </div>
    </div>
  );
}
