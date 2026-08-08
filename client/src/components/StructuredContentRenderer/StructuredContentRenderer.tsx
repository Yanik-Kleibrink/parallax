import type { StructuredContent, Item } from "@/models";
import { BaseManagerContext, NodeIDContext } from "@/providers";
import { ProgressIcon } from "@/utils";

import {
  useContext,
  useEffect,
  useState,
  useLayoutEffect,
  type JSX,
} from "react";
import { Copy, ArrowRight } from "react-bootstrap-icons";
import { Highlight, themes } from "prism-react-renderer";
import Prism from "prismjs";

import "./StructuredContentRenderer.scss";

/**
 * A context that tracks important information during the rendering of structured content.
 */
interface StructuredContentRendererContext {
  /**
   * The current depth of the headlines being rendered.
   */
  depth: number;

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
    const headlineLevel = Math.min(context.depth + 1, 6);
    const Headline = `h${headlineLevel}` as keyof JSX.IntrinsicElements;
    return (
      <div className="structured-content__section">
        <Headline
          id={`node-${content.Section.key}`}
          className="structured-content__section-headline"
        >
          {content.Section.title.map((subContent, index) => (
            <StructuredContentRenderer
              key={index}
              content={subContent}
              context={{ ...context, depth: context.depth + 1 }}
            />
          ))}
        </Headline>
        {content.Section.content.map((subContent, index) => (
          <StructuredContentRenderer
            key={index}
            content={subContent}
            context={{ ...context, depth: context.depth + 1 }}
          />
        ))}
      </div>
    );
  }
  if ("ProgressSection" in content) {
    const headlineLevel = Math.min(context.depth + 1, 6);
    const Headline = `h${headlineLevel}` as keyof JSX.IntrinsicElements;
    return (
      <div className="structured-content__progress-section">
        <Headline
          id={`node-${content.ProgressSection.key}`}
          className="structured-content__progress-section-headline"
        >
          <span className="structured-content__progress-section__title">
            <ProgressIcon
              progress={content.ProgressSection.state}
              style={{
                display: "inline",
                marginRight: "0.5em",
                width: "1em",
                height: "1em",
                verticalAlign: "-0.125em",
              }}
            />
            {content.ProgressSection.title.map((subContent, index) => (
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
        </Headline>
        {content.ProgressSection.content.map((subContent, index) => (
          <StructuredContentRenderer
            key={index}
            content={subContent}
            context={{ ...context, depth: context.depth + 1 }}
          />
        ))}
      </div>
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
          e.preventDefault();
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
        {content.Block.name && (
          <div className="structured-content__block__name">
            {content.Block.name.map((subContent, index) => (
              <StructuredContentRenderer
                key={index}
                content={subContent}
                context={{
                  ...context,
                  depth: context.depth + 1,
                }}
              />
            ))}
          </div>
        )}
        {content.Block.content.map((subContent, index) => (
          <StructuredContentRenderer
            key={index}
            content={subContent}
            context={{ ...context, depth: context.depth + 1 }}
          />
        ))}
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
          onClick={() => {
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
                onClick={() => context.openReference?.(key)}
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
        onClick={() => {
          if ("URL" in content.Link.target) {
            window.open(
              content.Link.target.URL,
              "_blank",
              "noopener,noreferrer"
            );
          } else {
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
    return (
      <div
        className={`structured-content__tqf structured-content__tqf--${content.TQF.flavor.toLowerCase()}`}
      >
        {content.TQF.content.map((subContent, index) => (
          <StructuredContentRenderer
            key={index}
            content={subContent}
            context={{ ...context, depth: context.depth + 1 }}
          />
        ))}
      </div>
    );
  }
  if ("Itemize" in content) {
    return (
      <ul className="structured-content__itemize">
        {content.Itemize.items.map((item, index) => (
          <li key={index} className="structured-content__itemize-item">
            {item.map((subContent, subIndex) => (
              <StructuredContentRenderer
                key={subIndex}
                content={subContent}
                context={{
                  ...context,
                  depth: context.depth + 1,
                }}
              />
            ))}
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

  const [item, setItem] = useState<Item | null>(null);

  useEffect(() => {
    if (!baseManager) return;

    const unsubscribe = baseManager.subscribe(name, setItem);

    baseManager
      .retrieve(name)
      .then(setItem)
      .catch(() => {});

    return unsubscribe;
  }, [baseManager, name, context]);

  useLayoutEffect(() => {
    context.handleContentRender?.();
  }, [item, context]);

  if (item && item.content) {
    return (
      <>
        {item.content.map((subContent, index) => (
          <StructuredContentRenderer
            key={index}
            content={subContent}
            context={context}
          />
        ))}
      </>
    );
  } else {
    return null;
  }
}
