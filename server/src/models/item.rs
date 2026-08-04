use crate::html::citations::CitationType;
use crate::models::structured_content::StructuredContent;

use serde::Serialize;
use std::sync::Arc;
use xxhash_rust::xxh3::xxh3_64;

/// This is additional information that is only relevant for articles
/// and general references.
#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct CitationInformation {
    pub subtype: CitationType,

    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<i32>,
    pub month: Option<u8>,
    pub day: Option<u8>,
    pub location: String,
}

/// The different types of items managed by parallax
#[derive(Debug, PartialEq, Serialize, Clone, Copy)]
pub enum ItemFlavor {
    /// A knowledge item contains well-known results that do not need
    /// to be attributed independently.
    Knowledge,
    /// A view is a top-level tag.
    ///
    /// Its subsections are also tags.
    /// Every item should fit into at most one subsection of a view
    /// but can be included into multiple views.
    View(ViewState),

    /// The primitive for the start of a research project.
    Research(ResearchState),

    /// The primitive for a report, e.g., a thesis, survey, etc.
    Report(ReportState),

    /// The primitive for a project that is not research, e.g.,
    /// software
    Project(ProjectState),

    /// The primitive for teaching activities, e.g., courses,
    /// seminars, etc.
    Teaching(TeachingState),

    /// The primitive for organizing scientific activities, e.g.,
    /// workshops,
    Activity(ActivityState),

    /// The primitive for personal talks, e.g., talks given at
    /// conferences,
    Talk(TalkState),

    /// The primitive for the published article of somebody else.
    Article {
        read_state: ArticleState,
        desire_state: ArticleState,
    },

    /// A general reference.
    ///
    /// In comparison to an article, here the content should only be
    /// summarized and the main item should read more like a
    /// review of the book. The main point of a general reference
    /// is that it contains the information for the knowledge base but
    /// the results never need to be individually attributed to the
    /// reference.
    GeneralReference,

    /// A constituent is a part of any of the above items.
    ///
    /// It does not make sense alone.
    Constituent,
}

/// The state of a view.
#[derive(Debug, PartialEq, Serialize, Clone, Copy)]
pub enum ViewState {
    Inactive,
    Start,
    Expansion,
    Activation,
    Active,
}

/// The state of a research project.
#[derive(Debug, PartialEq, Serialize, Clone, Copy)]
pub enum ResearchState {
    Upgrading,
    Active,
    Formalizing,
    Preprint,
    Published,
    Paused,
    Failed,
}

/// The state of a report like a thesis or survey.
#[derive(Debug, PartialEq, Serialize, Clone, Copy)]
pub enum ReportState {
    Draft,
    Final,
    Abandoned,
}

/// The state of a project.
#[derive(Debug, PartialEq, Serialize, Clone, Copy)]
pub enum ProjectState {
    Active,
    Abandoned,
}

/// The state of a teaching activity.
#[derive(Debug, PartialEq, Serialize, Clone, Copy)]
pub enum TeachingState {
    Current,
    Archived,
}

/// The state of a organizing a scientific activity.
#[derive(Debug, PartialEq, Serialize, Clone, Copy)]
pub enum ActivityState {
    Preparing,
    Archived,
    Abandoned,
}

/// The state of a personal talk.
#[derive(Debug, PartialEq, Serialize, Clone, Copy)]
pub enum TalkState {
    Draft,
    Final,
    Abandoned,
}

/// The state of an article represents to what extent the article has
/// been understood.
#[derive(Debug, PartialEq, Serialize, Clone, Copy)]
pub enum ArticleState {
    New,
    One,
    Two,
    Three,
}

/// An asset that is associated with an item.
#[derive(Debug, Serialize, Clone)]
pub enum ItemAsset {
    /// An asset that is stored locally on the server.
    Local,

    /// A URL to an asset that is stored remotely.
    Remote(String),
}

impl ItemAsset {
    pub fn hash(&self) -> u64 {
        match self {
            ItemAsset::Local => xxh3_64(b"local"),
            ItemAsset::Remote(url) => {
                let s = format!("remote:{}", url);
                xxh3_64(s.as_bytes())
            }
        }
    }
}

/// The main parsed structure of an item.
#[derive(Debug, Serialize, Clone)]
pub struct Item {
    pub key: String,

    pub flavor: ItemFlavor,

    pub hash: u64,

    /// This title only exists for non-constituent items.
    pub title: Option<Arc<Vec<StructuredContent>>>,

    pub content: Arc<Vec<StructuredContent>>,

    /// This is only relevant for articles and general references.
    pub citation_information: Option<CitationInformation>,

    /// A PDF that is associated with the item, e.g., a paper PDF.
    pub pdf: Option<ItemAsset>,

    /// A website that is associated with the item, e.g., a project
    /// website.
    ///
    /// Note that this is the path to the top-level website. Local
    /// items can reside below the top level.
    pub html: Option<ItemAsset>,

    /// A video that is associated with the item, e.g., a talk video.
    pub video: Option<ItemAsset>,
}

/// A vector of these structures is used for the clients to resync
/// with the server after a disconnection.
#[derive(Serialize, Debug)]
pub struct ItemFreshness {
    pub key: String,
    pub hash: u64,
    pub flavor: ItemFlavor,
}
