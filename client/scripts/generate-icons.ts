import fs from "node:fs/promises";
import Handlebars from "handlebars";

// Generate assets folder if it does not exist
await fs.mkdir("src/assets", { recursive: true });

const template = await fs.readFile("scripts/icon.svg.hbs", "utf8");

// This ensures that the ids used in the SVG are unique, preventing conflicts when multiple icons are used on the same page.
let id = 1;

const compile = Handlebars.compile(template);

const variants = [
  {
    flavor: "View",
    iconName: "pause",
    segments: 4,
    filled: 0,
    name: "view-inactive",
  },
  {
    flavor: "View",
    iconName: "binoculars-fill",
    segments: 4,
    filled: 1,
    name: "view-start",
  },
  {
    flavor: "View",
    iconName: "binoculars-fill",
    segments: 4,
    filled: 2,
    name: "view-expansion",
  },
  {
    flavor: "View",
    iconName: "binoculars-fill",
    segments: 4,
    filled: 3,
    name: "view-activation",
  },
  {
    flavor: "View",
    iconName: "binoculars-fill",
    segments: 4,
    filled: 4,
    name: "view-active",
  },
  {
    flavor: "Research",
    iconName: "pause",
    segments: 5,
    filled: 0,
    name: "research-paused",
  },
  {
    flavor: "Research",
    iconName: "bug-fill",
    segments: 5,
    filled: 0,
    name: "research-failed",
  },
  {
    flavor: "Research",
    iconName: "flask",
    segments: 5,
    filled: 1,
    name: "research-upgrading",
  },
  {
    flavor: "Research",
    iconName: "flask",
    segments: 5,
    filled: 2,
    name: "research-active",
  },
  {
    flavor: "Research",
    iconName: "flask",
    segments: 5,
    filled: 3,
    name: "research-formalizing",
  },
  {
    flavor: "Research",
    iconName: "flask",
    segments: 5,
    filled: 4,
    name: "research-preprint",
  },
  {
    flavor: "Research",
    iconName: "check-lg",
    segments: 5,
    filled: 5,
    name: "research-published",
  },
  {
    flavor: "Report",
    iconName: "file-earmark-text-fill",
    segments: 2,
    filled: 1,
    name: "report-draft",
  },
  {
    flavor: "Report",
    iconName: "check-lg",
    segments: 2,
    filled: 2,
    name: "report-final",
  },
  {
    flavor: "Report",
    iconName: "bug-fill",
    segments: 2,
    filled: 0,
    name: "report-abandoned",
  },
  {
    flavor: "Project",
    iconName: "folder-fill",
    segments: 1,
    filled: 1,
    name: "project-active",
  },
  {
    flavor: "Project",
    iconName: "bug-fill",
    segments: 1,
    filled: 0,
    name: "project-abandoned",
  },
  {
    flavor: "Teaching",
    iconName: "book-fill",
    segments: 1,
    filled: 1,
    name: "teaching-current",
  },
  {
    flavor: "Teaching",
    iconName: "check-lg",
    segments: 1,
    filled: 0,
    name: "teaching-archived",
  },
  {
    flavor: "Activity",
    iconName: "calendar-event-fill",
    segments: 1,
    filled: 1,
    name: "activity-preparing",
  },
  {
    flavor: "Activity",
    iconName: "check-lg",
    segments: 1,
    filled: 0,
    name: "activity-archived",
  },
  {
    flavor: "Activity",
    iconName: "bug-fill",
    segments: 1,
    filled: 0,
    name: "activity-abandoned",
  },
  {
    flavor: "Talk",
    iconName: "chat-square-text-fill",
    segments: 2,
    filled: 1,
    name: "talk-draft",
  },
  {
    flavor: "Talk",
    iconName: "check-lg",
    segments: 2,
    filled: 2,
    name: "talk-final",
  },
  {
    flavor: "Talk",
    iconName: "bug-fill",
    segments: 2,
    filled: 0,
    name: "talk-abandoned",
  },
  {
    flavor: "Knowledge",
    iconName: "book-fill",
    segments: 0,
    filled: 0,
    name: "knowledge",
  },
];

for (const variant of variants) {
  // Get icon
  const icon = (
    await fs.readFile(
      `node_modules/bootstrap-icons/icons/${variant.iconName}.svg`,
      "utf8"
    )
  )
    .replace(/<svg[^>]*>/i, "") // Remove opening <svg ...> tag
    .replace(/<\/svg>/i, "") // Remove closing </svg> tag
    .trim();
  const circumference = 2 * 40 * Math.PI;
  const gap = circumference * 0.04; // 2% gap
  const gapInside = circumference * 0.05; // 3% gap
  const segmentLength =
    variant.segments == 0
      ? 2 * circumference // Needs to exceed circumference to not create the rounded stop at the end of the circle
      : circumference / variant.segments;
  const segmentContentInside = segmentLength - gapInside; // 3% gap
  const segmentContent = segmentLength - gap; // 2% gap
  const svg = compile({
    ...variant,
    id: id,
    offsetOutside: -gap / 2,
    offsetInside: -gapInside / 2,
    notEmpty: variant.filled != 0,
    patternProgress:
      variant.filled > 0 && variant.segments > 0
        ? `${segmentContent} ${gap} `.repeat(variant.filled - 1) +
          `${segmentContent} ` +
          ((variant.segments - variant.filled) * segmentLength + gap)
        : "",
    patternInside:
      variant.segments > 0 ? `${segmentContentInside} ${gapInside}` : "",
    patternOutside: variant.segments > 0 ? `${segmentContent} ${gap}` : "",
    icon: icon,
  });
  id = id + 1;

  const svgPath = `src/assets/${variant.name}.svg`;

  await fs.writeFile(svgPath, svg, "utf8");
}

const variantsReferences = [
  {
    name: "paper",
    iconName: "journal-text",
  },
  {
    name: "talk",
    iconName: "chat-square-text",
  },
  {
    name: "patent",
    iconName: "file-earmark-text",
  },
];

const svgStar = (
  await fs.readFile(`node_modules/bootstrap-icons/icons/star-fill.svg`, "utf8")
)
  .replace(/<svg[^>]*>/i, "") // Remove opening <svg ...> tag
  .replace(/<\/svg>/i, "") // Remove closing </svg> tag
  .trim();
const svgBox = (
  await fs.readFile(`node_modules/bootstrap-icons/icons/square.svg`, "utf8")
)
  .replace(/<svg[^>]*>/i, "") // Remove opening <svg ...> tag
  .replace(/<\/svg>/i, "") // Remove closing </svg> tag
  .trim();
const svgFillBox = (
  await fs.readFile(
    `node_modules/bootstrap-icons/icons/square-fill.svg`,
    "utf8"
  )
)
  .replace(/<svg[^>]*>/i, "") // Remove opening <svg ...> tag
  .replace(/<\/svg>/i, "") // Remove closing </svg> tag
  .trim();

const templateReferences = await fs.readFile(
  "scripts/references.svg.hbs",
  "utf8"
);

const compileReferences = Handlebars.compile(templateReferences);

function starConfiguration(desire: boolean, achieved: boolean) {
  if (desire && achieved) {
    return {
      background: svgFillBox,
      foreground: svgStar,
      inverted: false,
    };
  }
  if (desire && !achieved) {
    return {
      background: svgBox,
      foreground: svgStar,
      inverted: false,
    };
  }
  if (!desire && achieved) {
    return {
      background: svgFillBox,
      foreground: svgStar,
      inverted: true,
    };
  }
  return {
    background: svgBox,
    foreground: svgStar,
    inverted: true,
  };
}

for (const variant of variantsReferences) {
  // Get icon
  const icon = (
    await fs.readFile(
      `node_modules/bootstrap-icons/icons/${variant.iconName}.svg`,
      "utf8"
    )
  )
    .replace(/<svg[^>]*>/i, "") // Remove opening <svg ...> tag
    .replace(/<\/svg>/i, "") // Remove closing </svg> tag
    .trim();

  const states = ["new", "one", "two", "three"];
  states.forEach(async (desire_state, desire_index) => {
    states.forEach(async (achieved_state, achieved_index) => {
      const starStates = [
        [desire_index >= 1, achieved_index >= 1],
        [desire_index >= 2, achieved_index >= 2],
        [desire_index >= 3, achieved_index >= 3],
      ];

      const presentStarsConfiguration = {
        one: { present: false },
        two: { present: false },
        three: { present: false },
      };
      presentStarsConfiguration.two = starConfiguration(...starStates[0]);
      presentStarsConfiguration.one = starConfiguration(...starStates[1]);
      presentStarsConfiguration.three = starConfiguration(...starStates[2]);

      const svg = compileReferences({
        ...variant,
        ...presentStarsConfiguration,
        icon: icon,
        iconPresent: icon.trim() !== "",
        stars: true,
        id: id,
      });
      id = id + 1;

      const svgPath = `src/assets/${variant.name}-${achieved_state}-${desire_state}.svg`;

      await fs.writeFile(svgPath, svg, "utf8");
    });
  });
}

// Create the general reference icon
let svg = compileReferences({
  name: "reference",
  icon: (
    await fs.readFile(`node_modules/bootstrap-icons/icons/book.svg`, "utf8")
  )
    .replace(/<svg[^>]*>/i, "") // Remove opening <svg ...> tag
    .replace(/<\/svg>/i, "") // Remove closing </svg> tag
    .trim(),
  iconPresent: true,
  stars: false,
  id: id,
});
id = id + 1;
let svgPath = `src/assets/generalreference.svg`;
await fs.writeFile(svgPath, svg, "utf8");

// Create a discussion icon
svg = compileReferences({
  name: "discussion",
  icon: (
    await fs.readFile(
      `node_modules/bootstrap-icons/icons/people-fill.svg`,
      "utf8"
    )
  )
    .replace(/<svg[^>]*>/i, "") // Remove opening <svg ...> tag
    .replace(/<\/svg>/i, "") // Remove closing </svg> tag
    .trim(),
  iconPresent: true,
  stars: false,
  id: id,
});
id = id + 1;
svgPath = `src/assets/discussion.svg`;
await fs.writeFile(svgPath, svg, "utf8");

// Create the generic reference icon
svg = compileReferences({
  name: "reference",
  icon: "",
  iconPresent: false,
  stars: false,
  id: id,
});
id = id + 1;
svgPath = `src/assets/reference.svg`;
await fs.writeFile(svgPath, svg, "utf8");

// Copy tag icon
const tagIcon = await fs.readFile(
  `node_modules/bootstrap-icons/icons/tag-fill.svg`,
  "utf8"
);
await fs.writeFile(`src/assets/tag.svg`, tagIcon, "utf8");

const miniIcons = [
  {
    name: "research",
    iconName: "flask",
  },
  {
    name: "report",
    iconName: "file-earmark-text",
  },
  {
    name: "project",
    iconName: "folder",
  },
  {
    name: "teaching",
    iconName: "book",
  },
  {
    name: "activity",
    iconName: "calendar-event",
  },
  {
    name: "talk",
    iconName: "chat-square-text",
  },
  {
    name: "view",
    iconName: "binoculars",
  },
  {
    name: "error",
    iconName: "exclamation-triangle",
  },
];

for (const miniIcon of miniIcons) {
  const icon = await fs.readFile(
    `node_modules/bootstrap-icons/icons/${miniIcon.iconName}.svg`,
    "utf8"
  );
  await fs.writeFile(`src/assets/${miniIcon.name}-mini.svg`, icon, "utf8");
}
