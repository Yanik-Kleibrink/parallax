/**
 * This file contains the types for structured content.
 * It stems from the associated rust model.
 * In particular, the documentation resides there.
 */

export type ProgressState = "Proposed" | "Started" | "Completed" | "Paused";

export type TQFFlavor = "Question" | "Fix" | "Todo";

export type BlockFlavor =
  | "Theorem"
  | "Definition"
  | "Proposition"
  | "Notation"
  | "Proof"
  | "Example"
  | "Lemma"
  | "Corollary"
  | "Remark"
  | "Conjecture"
  | "Convention"
  | "Axiom"
  | { Unknown: string };

export interface Tag {
  title: StructuredContent[];

  content: StructuredContent[];

  subtags: Tag[];

  key: string;

  subitems: string[];
}

export type StructuredContent =
  | {
      Section: {
        title: StructuredContent[];
        content: StructuredContent[];
        entity: boolean;
        key: string;
      };
    }
  | {
      ProgressSection: {
        title: StructuredContent[];
        state: ProgressState;
        content: StructuredContent[];
        entity: boolean;
        key: string;
      };
    }
  | {
      Tag: Tag;
    }
  | {
      Paragraph: {
        content: StructuredContent[];
      };
    }
  | {
      Text: string;
    }
  | {
      LaTeX: {
        html: string;
      };
    }
  | {
      Block: {
        flavor: BlockFlavor;
        content: StructuredContent[];
        name: StructuredContent[] | null;
        label: string | null;
      };
    }
  | {
      Code: {
        content: string;
        language: string | null;
      };
    }
  | {
      Citation: {
        post_script: string;
        pre_script: string;
        references: [string, string][];
      };
    }
  | {
      Bold: StructuredContent[];
    }
  | {
      Italic: StructuredContent[];
    }
  | {
      Link: {
        text: StructuredContent[];
        url: string;
      };
    }
  | {
      TQF: {
        content: StructuredContent[];
        flavor: TQFFlavor;
      };
    }
  | {
      Itemize: {
        items: StructuredContent[][];
      };
    }
  | {
      Add: string;
    };
