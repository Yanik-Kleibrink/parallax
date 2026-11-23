import type { StructuredContent, Item, ProgressState } from "@/models";
import {
  BaseManagerContext,
  NO_SECTIONS,
  NodeIDContext,
  SectionContext,
  useRemoteSection,
  useRemoteTQF,
} from "@/providers";
import { convertToString, ProgressIcon } from "@/utils";

import {
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
  type JSX,
} from "react";
import {
  Copy,
  ArrowRight,
  ShieldFillCheck,
  ShieldSlashFill,
  X,
} from "react-bootstrap-icons";
import { Highlight, themes } from "prism-react-renderer";
import Prism from "prismjs";

import "./StructuredContentRenderer.scss";
import { TQFStack } from "./TQFStack";

/**
 * A context that tracks important information during the rendering of structured content.
 */
interface StructuredContentRendererContext {
  /**
   * The current depth of the headlines being rendered.
   */
  depth: number;

  /**
   * A function that is called with +1 when a constituent starts waiting for its item, and with -1 when it has it (or unmounts).
   *
   * It tells a pending scroll target whether the page may still grow (see NodeContent).
   */
  trackLoading?: (delta: number) => void;

  /**
   *   The function that is called with the reference key when the user clicks on a reference in a citation.
   */
  openReference?: (key: string) => void;

  /**
   * A function that is called when the content has been rendered.
   *
   * It can be used to trigger scrolling to a specific section after the content has been rendered.
   */
  handleContentRender?: () => void;
}

export function StructuredContentRenderer({
  content,
  context,
}: {
  content: StructuredContent;
  context: StructuredContentRendererContext;
}) {
  const nodeID = useContext(NodeIDContext);

  if ("Section" in content) {
    return (
      <Section
        sectionKey={content.Section.key}
        title={content.Section.title}
        contents={content.Section.content}
        context={context}
      />
    );
  }
  if ("ProgressSection" in content) {
    return (
      <Section
        sectionKey={content.ProgressSection.key}
        title={content.ProgressSection.title}
        contents={content.ProgressSection.content}
        progress={content.ProgressSection.state}
        context={context}
      />
    );
  }
  if ("Paragraph" in content) {
    return (
      <p className="structured-content__paragraph">
        {content.Paragraph.content.map((subContent, index) => (
          <StructuredContentRenderer
            key={index}
            content={subContent}
            context={{ ...context, depth: context.depth + 1 }}
          />
        ))}
      </p>
    );
  }
  if ("Text" in content) {
    return <span className="structured-content__text">{content.Text}</span>;
  }
  if ("LaTeX" in content) {
    if (content.LaTeX.display === "Display") {
      return (
        <div
          className="structured-content__latex structured-content__latex--display"
          dangerouslySetInnerHTML={{ __html: content.LaTeX.html }}
        />
      );
    } else {
      return (
        <span
          className="structured-content__latex structured-content__latex--inline"
          dangerouslySetInnerHTML={{ __html: content.LaTeX.html }}
        />
      );
    }
  }
  if ("Block" in content) {
    return (
      <div
        className={`structured-content__block structured-content__block--${typeof content.Block.flavor == "string" ? content.Block.flavor.toLowerCase() : "unknown"}`}
        id={content.Block.label ? `${content.Block.label}` : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (content.Block.label) {
            navigator.clipboard
              .writeText(`${nodeID}.${content.Block.label}`)
              .catch((err) => {
                console.error("Failed to copy block label: ", err);
              });
          } else {
            alert("This block does not have a label to copy.");
          }
        }}
      >
        {(content.Block.name || content.Block.verified !== null) && (
          <div className="structured-content__block__name">
            <span className="structured-content__block__name__content">
              {content.Block.name &&
                content.Block.name.map((subContent, index) => (
                  <StructuredContentRenderer
                    key={index}
                    content={subContent}
                    context={{
                      ...context,
                      depth: context.depth + 1,
                    }}
                  />
                ))}
            </span>
            {content.Block.verified !== null && (
              <span className="structured-content__block__name__verified">
                {content.Block.verified === true && <ShieldFillCheck />}
                {content.Block.verified === false && <ShieldSlashFill />}
              </span>
            )}
          </div>
        )}
        <StructuredContentList
          contents={content.Block.content}
          context={{ ...context, depth: context.depth + 1 }}
        />
      </div>
    );
  }
  if ("Suggestion" in content) {
    return (
      <div
        className={`structured-content__suggestion`}
        id={
          content.Suggestion.label ? `${content.Suggestion.label}` : undefined
        }
      >
        {content.Suggestion.name && (
          <div className="structured-content__suggestion__name">
            <StructuredContentList
              contents={content.Suggestion.name}
              context={{ ...context, depth: context.depth + 1 }}
            />
          </div>
        )}
        {content.Suggestion.comment && (
          <div className="structured-content__suggestion__comment">
            <StructuredContentList
              contents={content.Suggestion.comment}
              context={{ ...context, depth: context.depth + 1 }}
            />
          </div>
        )}
        {(content.Suggestion.old || content.Suggestion.new) && (
          <div
            className={`structured-content__suggestion__replacement ${content.Suggestion.old && content.Suggestion.new ? "structured-content__suggestion__replacement--both" : "structured-content__suggestion__replacement--single"}`}
          >
            {content.Suggestion.old && (
              <div className="structured-content__suggestion__replacement__old">
                <StructuredContentList
                  contents={content.Suggestion.old}
                  context={{ ...context, depth: context.depth + 1 }}
                />
              </div>
            )}
            {content.Suggestion.new && (
              <div className="structured-content__suggestion__replacement__new">
                <StructuredContentList
                  contents={content.Suggestion.new}
                  context={{ ...context, depth: context.depth + 1 }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
  if ("Code" in content) {
    return (
      <div className="structured-content__code">
        {content.Code.language && (
          <div className="structured-content__code__language">
            {content.Code.language.toUpperCase()}
          </div>
        )}
        <Highlight
          /* Need to manually reference the prismjs Prism instance the comes from
           vite-plugin-prismjs */
          prism={Prism}
          theme={themes.oneLight}
          code={content.Code.content.trim()}
          language={content.Code.language ? content.Code.language : "text"}
        >
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre className={`${className}`} style={style}>
              {tokens.map((line, i) => (
                <div key={i} {...getLineProps({ line })}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </div>
              ))}
            </pre>
          )}
        </Highlight>
        <button
          className="structured-content__code__copy-button"
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard
              .writeText(content.Code.content.trim())
              .catch((err) => {
                console.error("Failed to copy code: ", err);
                alert("Failed to copy code to clipboard.");
              });
          }}
        >
          <Copy />
        </button>
      </div>
    );
  }
  if ("Citation" in content) {
    return (
      <span className="structured-content__citation">
        {"["}
        <span className="structured-content__citation__pre-script">
          {content.Citation.pre_script}
        </span>
        <span className="structured-content__citation__references">
          {content.Citation.references.map(([key, abbreviation], index) => (
            <>
              <span
                key={key}
                className="structured-content__citation__references__reference"
                onClick={(e) => {
                  e.stopPropagation();
                  context.openReference?.(key);
                }}
              >
                {abbreviation}
              </span>
              {index < content.Citation.references.length - 1 && ", "}
            </>
          ))}
        </span>
        {content.Citation.post_script &&
          content.Citation.post_script.trim() !== "" && (
            <span className="structured-content__citation__post-script">
              {", "}
              {content.Citation.post_script}
            </span>
          )}
        {"]"}
      </span>
    );
  }

  if ("Bold" in content) {
    return (
      <strong className="structured-content__bold">
        {content.Bold.map((subContent, index) => (
          <StructuredContentRenderer
            key={index}
            content={subContent}
            context={{ ...context, depth: context.depth + 1 }}
          />
        ))}
      </strong>
    );
  }
  if ("Italic" in content) {
    return (
      <em className="structured-content__italic">
        {content.Italic.map((subContent, index) => (
          <StructuredContentRenderer
            key={index}
            content={subContent}
            context={{ ...context, depth: context.depth + 1 }}
          />
        ))}
      </em>
    );
  }
  if ("Link" in content) {
    return (
      <a
        className="structured-content__link"
        onClick={(e) => {
          if ("URL" in content.Link.target) {
            window.open(
              content.Link.target.URL,
              "_blank",
              "noopener,noreferrer"
            );
          } else {
            e.stopPropagation();
            context.openReference?.(
              content.Link.target.Item[0] +
                (content.Link.target.Item[1]
                  ? "#" + content.Link.target.Item[1]
                  : "")
            );
          }
        }}
      >
        {content.Link.text &&
          content.Link.text.map((subContent, index) => (
            <StructuredContentRenderer
              key={index}
              content={subContent}
              context={{ ...context, depth: context.depth + 1 }}
            />
          ))}
        {!content.Link.text && (
          <span className="structured-content__link__default-text">
            <ArrowRight />
          </span>
        )}
      </a>
    );
  }
  if ("TQF" in content) {
    return <TQF tqf={content.TQF} context={context} />;
  }
  if ("Itemize" in content) {
    return (
      <ul className="structured-content__itemize">
        {content.Itemize.items.map((item, index) => (
          <li key={index} className="structured-content__itemize-item">
            <StructuredContentList
              contents={item}
              context={{ ...context, depth: context.depth + 1 }}
            />
          </li>
        ))}
      </ul>
    );
  }
  if ("Add" in content) {
    return <Constituent name={content.Add} context={context} />;
  }

  return null;
}

/**
 * This component renders a section or a progress section with its headline and its contents.
 *
 * The headline is registered with the remote control, and the section passes its path to the sections inside it (see SectionContext).
 * @param sectionKey The key of the section.
 * @param title The title of the section.
 * @param contents The contents of the section.
 * @param progress The progress state, for a progress section.
 * @param context The rendering context.
 */
function Section({
  sectionKey,
  title,
  contents,
  progress,
  context,
}: {
  sectionKey: string;
  title: StructuredContent[];
  contents: StructuredContent[];
  progress?: ProgressState;
  context: StructuredContentRendererContext;
}) {
  const { path, headlineRef } = useRemoteSection(
    sectionKey,
    convertToString(title)
  );

  const headlineLevel = Math.min(context.depth + 1, 6);
  // Any headline level has the props of h1, including a ref to an HTMLHeadingElement.
  const Headline = `h${headlineLevel}` as "h1";
  const kind = progress ? "progress-section" : "section";
  const titleElements = title.map((subContent, index) => (
    <StructuredContentRenderer
      key={index}
      content={subContent}
      context={{ ...context, depth: context.depth + 1 }}
    />
  ));

  return (
    <div className={`structured-content__${kind}`}>
      <Headline
        ref={headlineRef}
        id={`node-${sectionKey}`}
        className={`structured-content__${kind}-headline`}
      >
        {progress ? (
          <span className="structured-content__progress-section__title">
            <ProgressIcon
              progress={progress}
              style={{
                display: "inline",
                marginRight: "0.5em",
                width: "1em",
                height: "1em",
                verticalAlign: "-0.125em",
              }}
            />
            {titleElements}
          </span>
        ) : (
          titleElements
        )}
      </Headline>
      <SectionContext value={path}>
        <StructuredContentList
          contents={contents}
          context={{ ...context, depth: context.depth + 1 }}
        />
      </SectionContext>
    </div>
  );
}

/**
 * This component renders a TQF as a card.
 *
 * While the remote control emphasizes it, the card pulses, and a TQF with an ID shows an X that dismisses it.
 * The X comes after the content, as the first child of the card is its summary line, which a folded card keeps (TQFStack.scss and TQFStackScroll.ts).
 * @param tqf The TQF.
 * @param context The rendering context.
 */
function TQF({
  tqf,
  context,
}: {
  tqf: Extract<StructuredContent, { TQF: unknown }>["TQF"];
  context: StructuredContentRendererContext;
}) {
  const { pulsing, dismissible, dismiss } = useRemoteTQF(tqf.id);

  return (
    <div
      className={[
        "structured-content__tqf",
        `structured-content__tqf--${tqf.flavor.toLowerCase()}`,
        pulsing && "structured-content__tqf--pulse",
        dismissible && "structured-content__tqf--dismissible",
      ]
        .filter(Boolean)
        .join(" ")}
      // This makes the card focusable, so that a stack stays open after a tap and can be used with the keyboard (see TQFStackScroll.ts).
      tabIndex={0}
    >
      <StructuredContentList
        contents={tqf.content}
        context={{ ...context, depth: context.depth + 1 }}
      />
      {dismissible && (
        <button
          type="button"
          className="structured-content__tqf-dismiss"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={(event) => {
            event.stopPropagation();
            dismiss();
          }}
        >
          <X />
        </button>
      )}
    </div>
  );
}

/**
 * Get a short hash of structured content, e.g. to key it by its content.
 * @param content The structured content.
 * @returns The hash.
 */
function contentHash(content: StructuredContent): string {
  const text = JSON.stringify(content);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Get the key of a block among its siblings, which says what the block is rather than where it is.
 *
 * With a key by position, a TQF added or removed above shifted every later block onto the component of another block.
 * A constituent then remounted without its item and rendered nothing until the item came again, so the page shrank for a moment and the scroll position fell, up to the top.
 * Sections are keyed by their key and constituents by their name, so that edits inside them keep them mounted; other blocks are keyed by their content.
 * @param content The block.
 * @returns The key (made unique among siblings by the caller).
 */
function blockKey(content: StructuredContent): string {
  if ("Section" in content) return `s-${content.Section.key}`;
  if ("ProgressSection" in content) return `s-${content.ProgressSection.key}`;
  if ("Add" in content) return `a-${content.Add}`;
  return `c-${contentHash(content)}`;
}

/**
 * This component renders a list of block content.
 *
 * Every run of consecutive TQFs goes into one TQFStack, so that it stacks and scrolls as a whole.
 * @param contents The block content to render.
 * @param context The rendering context that is passed to every item.
 */
export const StructuredContentList = memo(function StructuredContentList({
  contents,
  context,
}: {
  contents: StructuredContent[];
  context: StructuredContentRendererContext;
}) {
  const elements: JSX.Element[] = [];
  // Stacks are keyed by their order and cards by their content, not by their position, so that a live edit above or inside an open stack keeps it open with the same current card.
  let stacks = 0;
  const cardKeys = new Map<string, number>();
  const blockKeys = new Map<string, number>();
  let index = 0;
  while (index < contents.length) {
    if ("TQF" in contents[index]) {
      const start = index;
      while (index < contents.length && "TQF" in contents[index]) index++;
      elements.push(
        <TQFStack key={`tqf-${stacks++}`}>
          {contents.slice(start, index).map((subContent) => {
            const hash = contentHash(subContent);
            const count = cardKeys.get(hash) ?? 0;
            cardKeys.set(hash, count + 1);
            return (
              <StructuredContentRenderer
                key={`${hash}-${count}`}
                content={subContent}
                context={context}
              />
            );
          })}
        </TQFStack>
      );
    } else {
      const key = blockKey(contents[index]);
      const count = blockKeys.get(key) ?? 0;
      blockKeys.set(key, count + 1);
      elements.push(
        <StructuredContentRenderer
          key={`${key}-${count}`}
          content={contents[index]}
          context={context}
        />
      );
      index++;
    }
  }
  return <>{elements}</>;
});

/**
 * A component that renders a single constituent of structured content. In particular, it only works when a base manager is available in the context. If a base manager is not available, it will render nothing.
 */
function Constituent({
  name,
  context,
}: {
  name: string;
  context: StructuredContentRendererContext;
}) {
  const baseManager = useContext(BaseManagerContext);

  // A constituent that mounts again starts with the item that it had (see BaseManager.cached), so that it never renders empty for a frame.
  const [item, setItem] = useState<Item | null>(
    () => baseManager?.cached(name) ?? null
  );

  // Parents pass a fresh context object on every render ({ ...context, depth }), so the effects below must not depend on it:
  // otherwise every render of an ancestor (e.g. a click in the table of contents) refetches and re-renders every constituent.
  const latestContext = useRef(context);
  useLayoutEffect(() => {
    latestContext.current = context;
  });

  useEffect(() => {
    if (!baseManager) return;

    // subscribe already delivers the stored item (or requests it from the server), so no separate retrieve is needed.
    return baseManager.subscribe(name, setItem);
  }, [baseManager, name]);

  useLayoutEffect(() => {
    latestContext.current.handleContentRender?.();
  }, [item]);

  // While the constituent waits for its item, it is counted, so that a pending scroll target does not settle while the page may still grow.
  const waiting = item === null;
  useEffect(() => {
    if (!waiting) return;
    const track = latestContext.current.trackLoading;
    track?.(1);
    return () => track?.(-1);
  }, [waiting]);

  // The constituent's sections and TQFs belong to the constituent, not to the item that includes it, and its section paths start at its own sections (the remote control matches them against its file).
  if (item && item.content) {
    return (
      <NodeIDContext value={name}>
        <SectionContext value={NO_SECTIONS}>
          <StructuredContentList contents={item.content} context={context} />
        </SectionContext>
      </NodeIDContext>
    );
  } else {
    return null;
  }
}
