import "./BaseAutoIcon.scss";

/**
 * Generates a color based on a hash of the input string.
 *
 * This is useful for generating consistent colors for different base names.
 * @param str The input string to generate a color from.
 */
function colorFromString(str: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  const hue = Math.abs(hash) % 360;

  return `hsl(${hue}, 65%, 50%)`;
}

/**
 * A simple component that shows the first letter of the base name in front of a deterministic color based on the name.
 */
export function BaseAutoIcon({ baseName }: { baseName: string }) {
  return (
    <div
      className="base-auto-icon"

      style={{
        backgroundColor: colorFromString(baseName),
        color: "white",
      }}
    >
      <span>{baseName.toUpperCase().charAt(0)}</span>
    </div>
  );
}
