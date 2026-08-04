import type { ProgressState } from "@/models";

import {
  Circle,
  CircleFill,
  PlayCircle,
  PauseCircle,
  QuestionCircle,
} from "react-bootstrap-icons";
import type { IconProps } from "react-bootstrap-icons";

interface ProgressIconProps extends IconProps {
  progress: ProgressState;
}

/**
 * Returns the React component for the progress icon based on the provided ProgressState.
 */
export function ProgressIcon({ progress, ...props }: ProgressIconProps) {
  const Icon = (() => {
    switch (progress) {
      case "Proposed":
        return Circle;
      case "Started":
        return PlayCircle;
      case "Completed":
        return CircleFill;
      case "Paused":
        return PauseCircle;
      default:
        return QuestionCircle;
    }
  })();

  return <Icon {...props} />;
}
