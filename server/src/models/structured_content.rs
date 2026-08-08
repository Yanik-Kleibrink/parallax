use serde::Serialize;

/// This is the basic element returned by the parser.
#[derive(Serialize, Debug, PartialEq)]
pub enum StructuredContent {
    /// A general section
    ///
    /// The depth is intentionally not tracked as this is determined
    /// by the client an depends on the composition of the content.
    Section {
        title: Vec<StructuredContent>,
        content: Vec<StructuredContent>,

        /// Indicates whether the section and its children should be
        /// shown as one unit.
        entity: bool,

        /// A hash of the content of the section that is used by the
        /// client to identify the section across updates.
        key: String,
    },

    /// A section that needs to be written.
    ///
    /// These are usually part of the report / paper being written.
    ProgressSection {
        title: Vec<StructuredContent>,
        state: ProgressState,

        content: Vec<StructuredContent>,

        /// Indicates whether the section and its children should be
        /// shown as one unit.
        entity: bool,

        /// A hash of the content of the section that is used by the
        /// client to identify the section across updates.
        key: String,
    },

    /// A special type of headline that functions as a tag.
    Tag(Tag),

    /// A simple paragraph of text.
    Paragraph {
        content: Vec<StructuredContent>,
    },

    /// A simple text element.
    Text(String),
    LaTeX {
        html: String,
    },

    /// A block element, e.g., a theorem, definition, proof, etc.
    Block {
        flavor: BlockFlavor,
        content: Vec<StructuredContent>,
        name: Option<Vec<StructuredContent>>,
        label: Option<String>,
    },

    /// A code block.
    Code {
        language: Option<String>,
        content: String,
    },

    /// A citation.
    ///
    /// The client is responsible for rendering and linking the
    /// references.
    Citation {
        post_script: String,
        pre_script: String,
        /// The first element is the citation key, the second element
        /// is the abbreviated citation form..
        references: Vec<(String, String)>,
    },

    /// Indicates that the content should be bolded where possible.
    Bold(Vec<StructuredContent>),

    /// Indicates that the content should be italicized where
    /// possible.
    Italic(Vec<StructuredContent>),

    /// An internal link to another item.
    ///
    /// In org mode links are written as `[[target][text]]` where
    /// `test`  `text` is the text to display for the link and
    /// target is either
    ///  - item_id
    ///  - item_id.label
    ///
    /// Note that the text can be ommitted.
    Link {
        text: Option<Vec<StructuredContent>>,
        target: LinkTarget,
    },

    /// A work item.
    ///
    /// The content is the description of the work item, and the
    /// flavor indicates whether it is a question, a fix, or a todo.
    TQF {
        content: Vec<StructuredContent>,
        flavor: TQFFlavor,
    },

    /// An itemized list.
    Itemize {
        items: Vec<Vec<StructuredContent>>,
    },

    /// This is a placeholder that indicates to the frontend that at
    /// this point the structured content of the string should be
    /// added.
    Add(String),
}

/// A tag is a special type of headline that functions as a tag.
#[derive(Serialize, Debug, PartialEq)]
pub struct Tag {
    /// The name of the tag.
    ///
    /// Note that the name might contain latex.
    pub title: Vec<StructuredContent>,

    /// Any sections that reside inside the tag headline that are not
    /// themselves tags.
    pub content: Vec<StructuredContent>,

    /// Any subtags that are nested inside this tag.
    ///
    /// These are the headlines with a tag of tag.
    pub subtags: Vec<Tag>,

    /// A hash of the content of the tag that is used by the client
    /// to identify the tag across updates.
    pub key: String,

    /// These are the keys of the subitems that are nested inside
    /// directly in this tag.
    pub subitems: Vec<String>,
}

/// The target of a link, either a URL or an item.
#[derive(Serialize, Debug, PartialEq)]
pub enum LinkTarget {
    /// A URL link.
    URL(String),
    /// The first element is the item id, the second element is the
    /// sub label.
    Item(String, Option<String>),
}

/// The flavor of a block element, e.g., a theorem, definition, proof,
/// etc.
#[derive(Serialize, Debug, PartialEq, strum::Display, Clone)]
pub enum BlockFlavor {
    Theorem,
    Definition,
    Proposition,
    Notation,
    Proof,
    Example,
    Lemma,
    Corollary,
    Remark,
    Conjecture,
    Convention,
    Axiom,
    Unknown(String),
}

/// The state of a progress section, e.g., proposed, started,
/// completed, paused.
#[derive(Serialize, Debug, PartialEq, strum::Display, Clone)]
pub enum ProgressState {
    Proposed,
    Started,
    Completed,
    Paused,
}

/// The flavor of a work item, e.g., a question, a fix, or a todo.
#[derive(Serialize, Debug, PartialEq, strum::Display, Clone)]
pub enum TQFFlavor {
    Question,
    Fix,
    Todo,
}
