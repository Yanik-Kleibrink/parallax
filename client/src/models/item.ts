/**
 * This file contains the data model for an item in the system.
 * It stems from the associated rust model.
 * In particular, the documentation resides there.
 */

import type { StructuredContent } from "./structured-content";

export type CitationType = "Paper" | "Talk" | "Patent" | "Discussion";

export interface CitationInformation {
  subtype: CitationType;

  title: string;
  authors: string[];
  year: number | null;
  month: number | null;
  day: number | null;
  location: string;
}

export type ViewState =
  "Inactive" | "Start" | "Expansion" | "Activation" | "Active";

export type ResearchState =
  | "Upgrading"
  | "Active"
  | "Formalizing"
  | "Preprint"
  | "Published"
  | "Paused"
  | "Failed";

export type ReportState = "Draft" | "Final" | "Abandoned";

export type ProjectState = "Active" | "Abandoned";

export type TeachingState = "Current" | "Archived";

export type ActivityState = "Preparing" | "Archived" | "Abandoned";

export type TalkState = "Draft" | "Final" | "Abandoned";

export type ArticleState = "New" | "One" | "Two" | "Three";

export type ItemFlavor =
  | "Knowledge"
  | { View: ViewState }
  | { Research: ResearchState }
  | { Report: ReportState }
  | { Project: ProjectState }
  | { Teaching: TeachingState }
  | { Activity: ActivityState }
  | { Talk: TalkState }
  | {
      Article: {
        read_state: ArticleState;
        desire_state: ArticleState;
      };
    }
  | "GeneralReference"
  | "Constituent";

export type MiniNodeFlavor =
  | "Knowledge"
  | "View"
  | "Research"
  | "Report"
  | "Project"
  | "Teaching"
  | "Activity"
  | "Talk"
  | "Article"
  | "GeneralReference"
  | "Constituent"
  | "Tag"
  | "Unknown";

export function toMiniNodeFlavor(
  flavor: ItemFlavor | "Tag" | "Unknown"
): MiniNodeFlavor {
  if (typeof flavor === "string") {
    return flavor;
  }
  if ("View" in flavor) {
    return "View";
  }
  if ("Research" in flavor) {
    return "Research";
  }
  if ("Report" in flavor) {
    return "Report";
  }
  if ("Project" in flavor) {
    return "Project";
  }
  if ("Teaching" in flavor) {
    return "Teaching";
  }
  if ("Activity" in flavor) {
    return "Activity";
  }
  if ("Talk" in flavor) {
    return "Talk";
  }
  if ("Article" in flavor) {
    return "Article";
  }
  throw new Error("Unknown flavor: " + JSON.stringify(flavor));
}

export type ItemAsset =
  | "Local"
  | {
      Remote: string;
    };

export interface Item {
  key: string;

  flavor: ItemFlavor;

  hash: number;

  title: StructuredContent[] | null;

  content: StructuredContent[];

  citation_information: CitationInformation | null;

  pdf: ItemAsset | null;

  html: ItemAsset | null;

  video: ItemAsset | null;
}

export interface ItemFreshness {
  key: string;
  hash: number;
  flavor: ItemFlavor;
}

export type ItemInformation =
  | {
      Update: Item;
    }
  | {
      Remove: string;
    }
  | {
      Inventory: [ItemFreshness[], number];
    };
