import type {
  CitationType,
  ItemFlavor,
  MiniNodeFlavor,
  ArticleState,
} from "@/models";

import chroma from "chroma-js";
import type { ComponentType, SVGProps } from "react";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const icons: Record<string, string> = import.meta.glob("/src/assets/*.svg", {
  eager: true,
  import: "default",
});
const iconsReact = import.meta.glob<IconComponent>("/src/assets/*.svg", {
  eager: true,
  query: "?react",
  import: "default",
});

/**
 * Converts an ArticleState enum value to its corresponding number representation.
 */
export function articleStateToNumber(state: ArticleState): number {
  switch (state) {
    case "New":
      return 0;
    case "One":
      return 1;
    case "Two":
      return 2;
    case "Three":
      return 3;
    default:
      return 0;
  }
}

/**
 * Handles "Paused" / "Abandoned" states cleanly.
 * Reduces saturation and slightly tones down lightness to make it look muted,
 * without turning it into pitch black or an invisible smudge.
 */
export function adjustStateColor(color: string, isInactive: boolean): string {
  if (!isInactive) return chroma(color).hex();

  return chroma(color)
    .desaturate(3) // Completely drain all hue/vibrancy
    .brighten(-0.6) // Darken significantly so it recedes
    .alpha(0.5) // (Optional) Softens edge contrast if your UI supports alpha hexes
    .hex();
}

/**
 * Returns a color string based on the provided flavor.
 * @param flavor - The flavor of the item or "Tag".
 * @returns A string representing the color associated with the flavor.
 */
export function getColorForFlavor(
  flavor: ItemFlavor | "Tag" | "Unknown"
): string {
  let isInactive = false;

  if (typeof flavor !== "string") {
    const status = Object.values(flavor)[0];
    isInactive =
      status === "Paused" ||
      status === "Abandoned" ||
      status === "Archived" ||
      status === "Failed" ||
      status === "Inactive";
  }

  // Refined, cohesive palette (modern, professional tones with high contrast)
  const BASE_PALETTE = {
    Tag: "#6B7280", // Muted Slate (replaces flat #808080)
    Unknown: "#6B7280", // Muted Slate
    GeneralReference: "#374151", // Charcoal (replaces stark #000000)
    Constituent: "#F59E0B", // Warm Amber
    Knowledge: "#EF4444", // Vibrant Coral/Red
    Research: "#10B981", // Emerald Green (replaces eye-straining #33FF57)
    Report: "#3B82F6", // Royal Blue
    Project: "#F59E0B", // Warm Amber
    Teaching: "#8B5CF6", // Soft Purple
    Activity: "#F97316", // Vivid Orange
    Talk: "#14B8A6", // Teal
    View: "#A855F7", // Indigo Violet
  };

  // Direct string flavors
  if (flavor === "Tag") return BASE_PALETTE.Tag;
  if (flavor === "Unknown") return BASE_PALETTE.Unknown;
  if (flavor === "GeneralReference") return BASE_PALETTE.GeneralReference;
  if (flavor === "Constituent") return BASE_PALETTE.Constituent;
  if (flavor === "Knowledge") return BASE_PALETTE.Knowledge;

  // Object-based flavors with active/inactive adjustments
  if ("Research" in flavor)
    return adjustStateColor(BASE_PALETTE.Research, isInactive);
  if ("Report" in flavor)
    return adjustStateColor(BASE_PALETTE.Report, isInactive);
  if ("Project" in flavor)
    return adjustStateColor(BASE_PALETTE.Project, isInactive);
  if ("Teaching" in flavor)
    return adjustStateColor(BASE_PALETTE.Teaching, isInactive);
  if ("Activity" in flavor)
    return adjustStateColor(BASE_PALETTE.Activity, isInactive);
  if ("Talk" in flavor) return adjustStateColor(BASE_PALETTE.Talk, isInactive);
  if ("View" in flavor) return adjustStateColor(BASE_PALETTE.View, isInactive);

  if ("Article" in flavor) {
    const delta = Math.max(
      articleStateToNumber(flavor["Article"].desire_state) -
        articleStateToNumber(flavor["Article"].read_state),
      0
    );

    let articleColor: string;
    switch (delta) {
      case 1:
        articleColor = "#10B981"; // Emerald Green
        break;
      case 2:
        articleColor = "#F97316"; // Vivid Orange
        break;
      case 3:
        articleColor = "#EF4444"; // Soft Crimson
        break;
      default:
        articleColor = "#4B5563"; // Slate Gray (fallback instead of black)
        break;
    }

    return adjustStateColor(articleColor, isInactive);
  }

  return BASE_PALETTE.Unknown;
}

/**
 * Returns the icon path based on the provided flavor and subtype.
 * @param flavor - The flavor of the item or "Tag". "Unknown" will yield an error icon.
 * @param subtype - The subtype of the citation, if applicable.
 * @returns A string representing the path to the icon associated with the flavor and subtype.
 */
function getIconForFlavorPath(
  flavor: ItemFlavor | "Tag" | "Unknown",
  subtype: CitationType | null
): string {
  if (flavor === "Tag") {
    return "/src/assets/tag.svg";
  }
  if (flavor === "GeneralReference") {
    if (subtype && subtype === "Discussion") {
      return "/src/assets/discussion.svg";
    }
    return "/src/assets/generalreference.svg";
  }
  if (flavor === "Knowledge") {
    return "/src/assets/knowledge.svg";
  }
  if (flavor === "Constituent") {
    return "/src/assets/error.svg";
  }
  if (flavor === "Unknown") {
    return "/src/assets/error.svg";
  }
  if ("Research" in flavor) {
    return `/src/assets/research-${flavor["Research"].toLowerCase()}.svg`;
  }
  if ("Report" in flavor) {
    return `/src/assets/report-${flavor["Report"].toLowerCase()}.svg`;
  }
  if ("Project" in flavor) {
    return `/src/assets/project-${flavor["Project"].toLowerCase()}.svg`;
  }
  if ("Teaching" in flavor) {
    return `/src/assets/teaching-${flavor["Teaching"].toLowerCase()}.svg`;
  }
  if ("Activity" in flavor) {
    return `/src/assets/activity-${flavor["Activity"].toLowerCase()}.svg`;
  }
  if ("Talk" in flavor) {
    return `/src/assets/talk-${flavor["Talk"].toLowerCase()}.svg`;
  }
  if ("View" in flavor) {
    return `/src/assets/view-${flavor["View"].toLowerCase()}.svg`;
  }
  if ("Article" in flavor) {
    if (subtype) {
      return `/src/assets/${subtype.toLowerCase()}-${flavor["Article"]["read_state"].toLowerCase()}-${flavor["Article"]["desire_state"].toLowerCase()}.svg`;
    }
    return `/src/assets/paper-${flavor["Article"]["read_state"].toLowerCase()}-${flavor["Article"]["desire_state"].toLowerCase()}.svg`;
  }
  return "/src/assets/error.svg";
}

/**
 * Returns the icon path based on the provided flavor and subtype.
 * @param flavor - The flavor of the item or "Tag".
 * @param subtype - The subtype of the citation, if applicable.
 * @returns A string representing the path to the icon associated with the flavor and subtype.
 */
export function getIconForFlavorURL(
  flavor: ItemFlavor | "Tag" | "Unknown",
  subtype: CitationType | null
): string {
  return icons[getIconForFlavorPath(flavor, subtype)];
}

/**
 * Returns the React component for the icon based on the provided flavor and subtype.
 * @param flavor - The flavor of the item or "Tag".
 * @param subtype - The subtype of the citation, if applicable.
 * @returns A React component representing the icon associated with the flavor and subtype.
 */
export function getIconForFlavorReact(
  flavor: ItemFlavor | "Tag" | "Unknown",
  subtype: CitationType | null
): IconComponent {
  return iconsReact[getIconForFlavorPath(flavor, subtype)];
}

/**
 * Returns the icon path for the mini icon based on the provided MiniNodeFlavor.
 *
 * @param flavor - The MiniNodeFlavor for which to get the mini icon path.
 * @returns A string representing the path to the mini icon associated with the flavor.
 */
export function getMiniIconForFlavorPath(flavor: MiniNodeFlavor): string {
  switch (flavor) {
    case "Tag":
      return "/src/assets/tag.svg";
    case "GeneralReference":
      return "/src/assets/reference.svg";
    case "Knowledge":
      return "/src/assets/knowledge.svg";
    case "Constituent":
      return "/src/assets/error-mini.svg";
    case "Research":
      return `/src/assets/research-mini.svg`;
    case "Report":
      return `/src/assets/report-mini.svg`;
    case "Project":
      return `/src/assets/project-mini.svg`;
    case "Teaching":
      return `/src/assets/teaching-mini.svg`;
    case "Activity":
      return `/src/assets/activity-mini.svg`;
    case "Talk":
      return `/src/assets/talk-mini.svg`;
    case "View":
      return `/src/assets/view-mini.svg`;
    case "Article":
      return "/src/assets/reference.svg";
    default:
      return "/src/assets/error-mini.svg";
  }
}

/**
 * Returns the React component for the mini icon based on the provided MiniNodeFlavor.
 *
 * @param flavor - The MiniNodeFlavor for which to get the mini icon.
 * @returns A React component representing the mini icon associated with the flavor.
 */
export function getMiniIconForFlavorReact(
  flavor: MiniNodeFlavor
): IconComponent {
  return iconsReact[getMiniIconForFlavorPath(flavor)];
}

/**
 * Returns the main color associated with a given MiniNodeFlavor.
 *
 * @param flavor - The MiniNodeFlavor for which to get the main color.
 * @returns A string representing the main color associated with the flavor.
 */
export function getMainColorForFlavor(flavor: MiniNodeFlavor): string {
  switch (flavor) {
    case "Tag":
      return "#808080";
    case "GeneralReference":
      return "#000000";
    case "Constituent":
      return "#F1C40F";
    case "Knowledge":
      return "#FF5733";
    case "Research":
      return "#33FF57";
    case "Report":
      return "#3357FF";
    case "Project":
      return "#F1C40F";
    case "Teaching":
      return "#9B59B6";
    case "Activity":
      return "#E67E22";
    case "Talk":
      return "#1ABC9C";
    case "View":
      return "#8E44AD";
    case "Article":
      return "#000000"; // Default color for Article flavor
    default:
      return "#808080";
  }
}
