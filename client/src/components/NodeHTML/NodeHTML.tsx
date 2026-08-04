import "./NodeHTML.scss";

/**
 * Renders an iframe for the given URL.
 */
export function NodeHTML({ url }: { url: string }) {
  return <iframe className="node-html" src={url} title="Node HTML Content" />;
}
