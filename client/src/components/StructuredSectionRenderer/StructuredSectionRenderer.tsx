import type { StructuredContent, Item } from "@/models";
import { BaseManagerContext } from "@/providers";
import { ProgressIcon } from "@/utils";
import { StructuredContentRenderer } from "@/components";

import { useContext, useEffect, useState } from "react";

import "./StructuredSectionRenderer.scss";

/**
 * A context that tracks important information during the rendering of structured sections.
 */
interface StructuredSectionRendererContext {
  /**
   * The action to undertake when a link is clicked.
   *
   * This might involve opening the contents section.
   */
  openLink?: (key: string) => void;
}

/**
 * Renders exactly the (progress) sections in the passed content.
 */
export function StructuredSectionRenderer({
  content,
  context,
}: {
  content: StructuredContent;
  context: StructuredSectionRendererContext;
}) {
  if ("Section" in content) {
    return (
      <li className="structured-section__section">
        {/*
        href is not used to prevent navigate from jumping to the section.
        Instead a custom scroll function in NodeContent will trigger.
          */}
        <a
          onClick={() =>
            context.openLink && context.openLink(content.Section.key)
          }
          className="structured-section__section__anchor"
        >
          <span className="structured-section__section__headline">
            <span className="structured-section__section__headline__title">
              {content.Section.title.map((subContent, index) => (
                <StructuredContentRenderer
                  key={index}
                  content={subContent}
                  context={{ depth: 0 }}
                />
              ))}
            </span>
          </span>
        </a>
        <ul className="structured-sections__subsections">
          {content.Section.content
            .filter(
              (subContent) =>
                "Section" in subContent ||
                "ProgressSection" in subContent ||
                "Add" in subContent
            )
            .map((subContent, index) => (
              <StructuredSectionRenderer
                key={index}
                content={subContent}
                context={context}
              />
            ))}
        </ul>
      </li>
    );
  }
  if ("ProgressSection" in content) {
    return (
      <li className="structured-section__section">
        {/*
        href is not used to prevent navigate from jumping to the section.
        Instead a custom scroll function in NodeContent will trigger.
          */}
        <a
          onClick={() =>
            context.openLink && context.openLink(content.ProgressSection.key)
          }
          className="structured-section__section__anchor"
        >
          <span className="structured-section__section__headline">
            <span className="structured-section__section__headline__title">
              {content.ProgressSection.title.map((subContent, index) => (
                <StructuredContentRenderer
                  key={index}
                  content={subContent}
                  context={{ depth: 0 }}
                />
              ))}
            </span>
            <ProgressIcon
              progress={content.ProgressSection.state}
              style={{
                display: "inline",
                marginRight: "0.5em",
                width: "1em",
                height: "1em",
                verticalAlign: "-0.125em",
                flexShrink: "0",
              }}
            />
          </span>
        </a>
        <ul className="structured-section__subsections">
          {content.ProgressSection.content
            .filter(
              (subContent) =>
                "Section" in subContent ||
                "ProgressSection" in subContent ||
                "Add" in subContent
            )
            .map((subContent, index) => (
              <StructuredSectionRenderer
                key={index}
                content={subContent}
                context={context}
              />
            ))}
        </ul>
      </li>
    );
  }
  if ("Add" in content) {
    return <ConstituentSection name={content.Add} context={context} />;
  }

  return null;
}

/**
 * A component that renders a single constituent of structured content. In particular, it only works when a base manager is available in the context. If a base manager is not available, it will render nothing.
 */
function ConstituentSection({
  name,
  context,
}: {
  name: string;
  context: StructuredSectionRendererContext;
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
  }, [baseManager, name]);

  if (item && item.content) {
    return (
      <>
        {item.content.map((subContent, index) => (
          <StructuredSectionRenderer
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
