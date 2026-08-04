import { type StructuredContent } from "@/models";
import type { Item, Tag } from "@/models";

/**
 * Check if the content is empty.
 * @param content The content to check.
 * @returns True if the content is empty, false otherwise.
 */
export function checkContentEmpty(content: StructuredContent[]): boolean {
  return content.every((c) => {
    if ("Text" in c) {
      return c.Text.trim() === "";
    }
    if ("Paragraph" in c) {
      return checkContentEmpty(c.Paragraph.content);
    }
    if ("Bold" in c) {
      return checkContentEmpty(c.Bold);
    }
    if ("Italic" in c) {
      return checkContentEmpty(c.Italic);
    }
    if ("Tag" in c) {
      return true;
    }
    return false;
  });
}

/**
 * Returns the node (Item or Tag) corresponding to the given nodeID within the provided item.
 *
 * Note that both Item and Tag have a key, title, and content property.
 */
export function getNode(nodeID: string, item: Item): Item | Tag | null {
  if (item.key === nodeID) {
    return item;
  }

  const pathToTag = nodeID.split(".");
  if (item.key !== pathToTag[0]) {
    return null;
  }

  // Walk the item content to find the correct tag.
  let currentNode: Item | Tag | null = item;
  let currentSubtags = item.content
    .filter((content) => "Tag" in content)
    .map((content) => content.Tag);
  for (let idx = 1; idx < pathToTag.length; idx++) {
    const tagKey = pathToTag[idx];

    currentNode = currentSubtags.find((tag) => tag.key === tagKey) ?? null;
    if (!currentNode || !("subtags" in currentNode)) {
      return null;
    }
    currentSubtags = currentNode.subtags;
  }

  return currentNode;
}

/**
 * Converts structured content to a plain string.
 *
 * This function does not progress through headlines and the like!.
 * @param content The structured content to convert.
 * @returns The plain string representation of the structured content.
 */
export function convertToString(content: StructuredContent[]): string {
  return content
    .map((c) => {
      if ("Text" in c) {
        return c.Text;
      }
      if ("Paragraph" in c) {
        return convertToString(c.Paragraph.content);
      }
      if ("Bold" in c) {
        return convertToString(c.Bold);
      }
      if ("Italic" in c) {
        return convertToString(c.Italic);
      }
      if ("Tag" in c) {
        return "";
      }
      return "";
    })
    .join("");
}
