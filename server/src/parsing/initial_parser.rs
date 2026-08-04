use crate::models::item::*;
use crate::models::structured_content::StructuredContent;
use crate::parsing::ItemMetadata;
use crate::parsing::deep_parser::HTMLExportConfiguration;
use crate::parsing::regexes::*;

use futures_util::future::Either;
use std::path::PathBuf;
use tracing::{debug, error, info, warn};

use std::collections::HashSet;
use std::sync::Arc;

// The file name for the bibliography file that is dumped when the
// #+dump_bibliography specifier is used.
static DEFAULT_BIBLIOGRAPHY_FILENAME: &str = ".parallax.bib";

/// These are helper functions that assist in the pre-orgize parsing
/// of an item.

/// Extract the item flavor (e.g article, view, etc.).
pub fn extract_flavor(org_content: &str) -> ItemFlavor {
    let mut top = FIND_TOP.captures_iter(&org_content);
    if let Some(capture) = top.next() {
        // Ensure that there isn't a second match.
        if top.next().is_some() {
            error!("Multiple top specifieres. Aborting.");
            return ItemFlavor::Constituent;
        }

        // Decode top type.
        if let Some(m) = capture.name("top_type") {
            let top_type_raw = &org_content[m.start()..m.end()];
            match top_type_raw {
                "knowledge" => return ItemFlavor::Knowledge,
                "view" => {
                    if let Some(m) = capture.name("subtype") {
                        let subtype_raw =
                            &org_content[m.start()..m.end()];
                        match subtype_raw {
                            "inactive" => {
                                return ItemFlavor::View(
                                    ViewState::Inactive,
                                );
                            }
                            "start" => {
                                return ItemFlavor::View(
                                    ViewState::Start,
                                );
                            }
                            "expansion" => {
                                return ItemFlavor::View(
                                    ViewState::Expansion,
                                );
                            }
                            "activation" => {
                                return ItemFlavor::View(
                                    ViewState::Activation,
                                );
                            }
                            "active" => {
                                return ItemFlavor::View(
                                    ViewState::Active,
                                );
                            }
                            _ => {
                                error!(
                                    "Unknown view subtype. Setting to Constituent."
                                );
                            }
                        }
                    } else {
                        error!("Could not determine subtype of view");
                    }
                }
                "research" => {
                    if let Some(m) = capture.name("subtype") {
                        let subtype_raw =
                            &org_content[m.start()..m.end()];
                        match subtype_raw {
                            "upgrading" => {
                                return ItemFlavor::Research(
                                    ResearchState::Upgrading,
                                );
                            }
                            "active" => {
                                return ItemFlavor::Research(
                                    ResearchState::Active,
                                );
                            }
                            "formalizing" => {
                                return ItemFlavor::Research(
                                    ResearchState::Formalizing,
                                );
                            }
                            "preprint" => {
                                return ItemFlavor::Research(
                                    ResearchState::Preprint,
                                );
                            }
                            "published" => {
                                return ItemFlavor::Research(
                                    ResearchState::Published,
                                );
                            }
                            "paused" => {
                                return ItemFlavor::Research(
                                    ResearchState::Paused,
                                );
                            }
                            "failed" => {
                                return ItemFlavor::Research(
                                    ResearchState::Failed,
                                );
                            }
                            _ => {
                                error!(
                                    "Unknown research subtype. Setting to Constituent."
                                );
                            }
                        }
                    } else {
                        error!(
                            "Could not determine subtype of research"
                        );
                    }
                }
                "report" => {
                    if let Some(m) = capture.name("subtype") {
                        let subtype_raw =
                            &org_content[m.start()..m.end()];
                        match subtype_raw {
                            "draft" => {
                                return ItemFlavor::Report(
                                    ReportState::Draft,
                                );
                            }
                            "final" => {
                                return ItemFlavor::Report(
                                    ReportState::Final,
                                );
                            }
                            "abandoned" => {
                                return ItemFlavor::Report(
                                    ReportState::Abandoned,
                                );
                            }
                            _ => {
                                error!(
                                    "Unknown report subtype. Setting to Constituent."
                                );
                            }
                        }
                    } else {
                        error!(
                            "Could not determine subtype of report"
                        );
                    }
                }
                "project" => {
                    if let Some(m) = capture.name("subtype") {
                        let subtype_raw =
                            &org_content[m.start()..m.end()];
                        match subtype_raw {
                            "active" => {
                                return ItemFlavor::Project(
                                    ProjectState::Active,
                                );
                            }
                            "abandoned" => {
                                return ItemFlavor::Project(
                                    ProjectState::Abandoned,
                                );
                            }
                            _ => {
                                error!(
                                    "Unknown project subtype. Setting to Constituent."
                                );
                            }
                        }
                    } else {
                        error!(
                            "Could not determine subtype of project"
                        );
                    }
                }
                "teaching" => {
                    if let Some(m) = capture.name("subtype") {
                        let subtype_raw =
                            &org_content[m.start()..m.end()];
                        match subtype_raw {
                            "current" => {
                                return ItemFlavor::Teaching(
                                    TeachingState::Current,
                                );
                            }
                            "complete" => {
                                return ItemFlavor::Teaching(
                                    TeachingState::Archived,
                                );
                            }
                            _ => {
                                error!(
                                    "Unknown teaching subtype. Setting to Constituent."
                                );
                            }
                        }
                    } else {
                        error!(
                            "Could not determine subtype of teaching"
                        );
                    }
                }
                "activity" => {
                    if let Some(m) = capture.name("subtype") {
                        let subtype_raw =
                            &org_content[m.start()..m.end()];
                        match subtype_raw {
                            "preparing" => {
                                return ItemFlavor::Activity(
                                    ActivityState::Preparing,
                                );
                            }
                            "archived" => {
                                return ItemFlavor::Activity(
                                    ActivityState::Archived,
                                );
                            }
                            "abandoned" => {
                                return ItemFlavor::Activity(
                                    ActivityState::Abandoned,
                                );
                            }
                            _ => {
                                error!(
                                    "Unknown activity subtype. Setting to Constituent."
                                );
                            }
                        }
                    } else {
                        error!(
                            "Could not determine subtype of activity"
                        );
                    }
                }
                "talk" => {
                    if let Some(m) = capture.name("subtype") {
                        let subtype_raw =
                            &org_content[m.start()..m.end()];
                        match subtype_raw {
                            "draft" => {
                                return ItemFlavor::Talk(
                                    TalkState::Draft,
                                );
                            }
                            "final" => {
                                return ItemFlavor::Talk(
                                    TalkState::Final,
                                );
                            }
                            "abandoned" => {
                                return ItemFlavor::Talk(
                                    TalkState::Abandoned,
                                );
                            }
                            _ => {
                                error!(
                                    "Unknown activity subtype. Setting to Constituent."
                                );
                            }
                        }
                    } else {
                        error!(
                            "Could not determine subtype of activity"
                        );
                    }
                }
                "reference" => {
                    if let Some(m) = capture.name("subtype") {
                        let subtype_raw =
                            &org_content[m.start()..m.end()].trim();
                        if subtype_raw.is_empty() {
                            debug!(
                                "Found reference with no subtype. Setting to GeneralReference."
                            );
                            return ItemFlavor::GeneralReference;
                        }
                        let types = subtype_raw.split(',').flat_map(|subtype| {
                            match subtype.to_lowercase().as_str() {
                                "new" => Some(ArticleState::New),
                                "one" => Some(ArticleState::One),
                                "two" => Some(ArticleState::Two),
                                "three" => Some(ArticleState::Three),
                                _ => {
                                    error!(
                                        subtype,
                                        "Unknown reference subtype:"
                                    );
                                    None
                                }
                            }
                        })
                        .collect::<Vec<ArticleState>>();

                        if types.is_empty() {
                            return ItemFlavor::GeneralReference;
                        }
                        if types.len() == 1 {
                            return ItemFlavor::Article {
                                read_state: types[0],
                                desire_state: ArticleState::New,
                            };
                        } else if types.len() == 2 {
                            return ItemFlavor::Article {
                                read_state: types[0],
                                desire_state: types[1],
                            };
                        } else {
                            error!(
                                "Too many reference subtypes. Setting to Constituent."
                            );
                        }
                    } else {
                        debug!(
                            "Found reference with no subtype. Setting to GeneralReference."
                        );
                        return ItemFlavor::GeneralReference;
                    }
                }
                _ => {
                    error!("Unknown top type. Setting to None.");
                }
            }
        } else {
            error!("Top type couldn't be set");
        }
    }

    // Next check for article flavor.
    let mut article = FIND_ARTICLE.captures_iter(&org_content);
    if let Some(capture) = article.next() {
        // Ensure that there isn't a second match.
        if article.next().is_some() {
            error!("Multiple article specifieres. Aborting.");
            return ItemFlavor::Constituent;
        }

        let mut desire_state = None;
        let mut read_state = None;

        // Decode article type.
        if let Some(m) = capture.name("level") {
            let top_type_raw = &org_content[m.start()..m.end()];
            debug!("Found article type: {}", top_type_raw);
            read_state = match top_type_raw {
                "NEW" => Some(ArticleState::New),
                "SECOND" => Some(ArticleState::One),
                "SKIMMED" => Some(ArticleState::Two),
                "READ" => Some(ArticleState::Three),
                _ => {
                    error!(
                        "Unknown article type. Setting to Constituent."
                    );
                    return ItemFlavor::Constituent;
                }
            };
        }

        if let Some(m) = capture.name("rest") {
            let rest_raw = &org_content[m.start()..m.end()];
            debug!("Found article rest: {}", rest_raw);
            if let Some(capture) =
                FIND_DESIRE.captures_iter(rest_raw).next()
            {
                if let Some(m2) = capture.name("desire") {
                    let desire_raw = &rest_raw[m2.start()..m2.end()];
                    debug!("Found desire type: {}", desire_raw);
                    desire_state = match desire_raw {
                        "desire_new" => Some(ArticleState::New),
                        "desire_one" => Some(ArticleState::One),
                        "desire_two" => Some(ArticleState::Two),
                        "desire_three" => Some(ArticleState::Three),
                        _ => None,
                    };
                }
            }
        }

        if desire_state.is_none() {
            warn!("No desire state found. Defaulting to New!");
            desire_state = Some(ArticleState::New);
        }

        if let (Some(read_state), Some(desire_state)) =
            (read_state, desire_state)
        {
            return ItemFlavor::Article {
                read_state: read_state,
                desire_state: desire_state,
            };
        } else {
            error!("Could not determine article type or desire");
        }
    }

    return ItemFlavor::Constituent;
}

/// Extract the metadata (e.g., included subitems, access rights,
/// dmos) from the org content.
pub fn extract_metadata(
    org_content: &str,
    item_path: &PathBuf,
    base_path: &PathBuf,
) -> ItemMetadata {
    let mut access_rights: Vec<String> = vec![];
    let mut dmos: Vec<String> = vec![];
    let mut visible = false;
    let mut referenced_citations: HashSet<String> = HashSet::new();
    let mut dump_bibliography: Option<PathBuf> = None;

    // Handle dump_bibliography
    let mut dump_bibliography_captures =
        FIND_DUMP_BIBLIOGRAPHY.captures_iter(&org_content);
    if let Some(capture) = dump_bibliography_captures.next() {
        if let Some(m) = capture.name("path") {
            let path = org_content[m.start()..m.end()].trim();

            dump_bibliography = match path {
                _ if path.starts_with("/") => {
                    // This also checks for existance.
                    base_path.join(path).canonicalize().ok()
                }
                _ => {
                    // This also checks for existance and handles the
                    // case of no argument being specified in
                    // dump_bibliography.
                    item_path.join(path).canonicalize().ok()
                }
            };

            // Append the default bibliography filename if the path is
            // a directory. This also handles the case of
            // no argument being specified in dump_bibliography.
            if let Some(ref path) = dump_bibliography
                && !path.is_file()
            {
                dump_bibliography =
                    Some(path.join(DEFAULT_BIBLIOGRAPHY_FILENAME));
            }
        } else {
            dump_bibliography =
                Some(item_path.join(DEFAULT_BIBLIOGRAPHY_FILENAME));
        }

        if let Some(_) = dump_bibliography_captures.next() {
            error!(
                "Multiple dump bibliography specifiers. Aborting."
            );
            access_rights = vec![];
        }
    }

    // Handle citations (this is the same logic as for render_latex in
    // deep_parser.rs)
    for caps in FIND_CITATIONS.captures_iter(org_content) {
        let keys_str = caps.name("keys").map_or("", |m| m.as_str());

        FIND_KEYS
            .captures_iter(keys_str)
            .filter_map(|cap| {
                cap.name("key").map(|m| m.as_str().to_string())
            })
            .for_each(|key| {
                referenced_citations.insert(key);
            });
    }

    // Handle visible
    let mut visible_captures =
        FIND_VISIBLE.captures_iter(&org_content);
    if let Some(_) = visible_captures.next() {
        visible = true;
        if let Some(_) = visible_captures.next() {
            error!("Multiple visible specifieres. Aborting.");
            visible = false;
        }
    }

    // Handle access rights
    let mut access_captures = FIND_ACCESS.captures_iter(&org_content);
    if let Some(capture) = access_captures.next() {
        if let Some(m) = capture.name("access") {
            access_rights = org_content[m.start()..m.end()]
                .split(',')
                .map(|item| item.trim())
                .map(String::from)
                .collect();
        } else {
            warn!(
                "No access rights granted despite #+access specifier."
            );
        }

        if let Some(_) = access_captures.next() {
            error!("Multiple access specifiers. Aborting.");
            access_rights = vec![];
        }
    }

    // Handle local declare math operators
    FIND_DECLARE_MATH_OPERATORS
        .captures_iter(&org_content)
        .for_each(|capture| {
            if let Some(m) = capture.name("dmo") {
                info!(
                    content = &org_content[m.start()..m.end()].trim(),
                    "Found DMO declaration"
                );
                dmos.push(
                    org_content[m.start()..m.end()].trim().into(),
                );
            } else {
                warn!("No DMO found despite #+dmo specifier.");
            }
        });

    // Handle inclusions
    let included_items = FIND_INCLUDED_FILE
        .captures_iter(&org_content)
        .map(|capture| {
            if let Some(m) = capture.name("basename") {
                return Some(&org_content[m.start()..m.end()]);
            }
            warn!("No basename found despite #+include specifier.");
            None
        })
        .flatten()
        .map(String::from)
        .collect();

    ItemMetadata {
        visible,
        access_rights,
        included_items,
        dmos,
        dump_bibliography,
        referenced_citations,
    }
}

pub fn render_title(
    default: &HTMLExportConfiguration,
    org_content: &str,
) -> Option<Arc<Vec<StructuredContent>>> {
    // First find the title in the org content.
    let mut title_iter = FIND_TITLE.captures_iter(&org_content);
    if let Some(capture) = title_iter.next() {
        if let Some(_) = title_iter.next() {
            error!("Multiple title specifieres. Aborting.");
            return None;
        }
        if let Some(m) = capture.name("title") {
            // NOTE: This could be optimized to not employ the full
            // orgize parser, but it is simpler to just use the export
            // configuration for this.
            let parsed =
                default.parse(org_content[m.start()..m.end()].trim());

            // Remove the outer paragraph if it is the only element.
            if parsed.len() == 1 {
                match parsed.into_iter().next().unwrap() {
                    StructuredContent::Paragraph { content } => {
                        return Some(Arc::new(content));
                    }
                    other => {
                        return Some(Arc::new(vec![other]));
                    }
                }
            } else {
                return Some(Arc::new(parsed));
            }
        } else {
            warn!("No title found despite #+title specifier.");
            return None;
        }
    } else {
        warn!("No title found in org content.");
        return None;
    }
}

/// This function removes top level article declarations from the org
/// content and returns the remaining content.
///
/// This is necessary because otherwise the deep parser will add an
/// additional headline. As the headline level is the prerogative of
/// the client, it is not possible to determine the correct level for
/// the headline.
pub fn get_content_in_article(org_content: &str) -> String {
    warn!(
        "Used old article declaration. Switch to #+reference: (new|one|two|three),(new|one|two|three)"
    );
    return FIND_ARTICLE.replace(org_content, "").into();
}

/// This struct contains the assets that are associated with an item.
///
/// It is a temporary data structure that informs the item of the
/// assets that are specified in its org content.
pub struct Assets {
    pub video: Option<Either<PathBuf, String>>,
    pub pdf: Option<Either<PathBuf, String>>,
    pub html: Option<Either<PathBuf, String>>,
}

/// This function extracts the assets from the org content and returns
/// them as a struct.
///
/// @param org_content The org content to extract the assets from.
/// @param path The path to the item directory. This is used to
/// resolve relative paths to assets.
pub fn get_assets(
    org_content: &str,
    path: &PathBuf,
    base_path: &PathBuf,
) -> Assets {
    let mut assets = Assets {
        video: None,
        pdf: None,
        html: None,
    };

    if let Some(parent_path) = path.parent() {
        FIND_ASSETS.captures_iter(&org_content).for_each(|capture| {
        if let Some(m) = capture.name("type") {
            let asset_type = org_content[m.start()..m.end()].trim();
            if let Some(m2) = capture.name("assets") {
                let asset_path =
                    org_content[m2.start()..m2.end()].trim();

                let asset_location = match asset_path {
                    _ if asset_path.starts_with("http://") || asset_path.starts_with("https://") => {
                        Some(Either::Right(asset_path.into()))
                    }
                    _ if asset_path.starts_with("/") => {
                        // This also checks for existance.
                        if let Ok(candidate_path) = base_path.join(asset_path).canonicalize() {
                            Some(Either::Left(candidate_path))
                        } else {
                            warn!(
                                path = asset_path,
                                  "Asset path does not exist. Ignoring.");
                            None
                        }
                    }
                    _ => {
                        // This also checks for existance.
                        if let Ok(candidate_path) = parent_path.join(asset_path).canonicalize() {
                            Some(Either::Left(candidate_path))
                        } else {
                            warn!(
                                path = asset_path,
                                  "Asset path does not exist. Ignoring.");
                            None
                        }
                    }
                };

                match asset_type {
                    "pdf" => {
                        if assets.pdf.is_some() {
                            warn!("Multiple pdf assets found. Ignoring.");
                        } else {
                            assets.pdf = asset_location;
                        }
                    },
                    "video" => {
                        if assets.video.is_some() {
                            warn!("Multiple video assets found. Ignoring.");
                        } else {
                            assets.video= asset_location;
                        }
                    },
                    "html" => {
                        if assets.html.is_some() {
                            warn!("Multiple html assets found. Ignoring.");
                        } else {
                            assets.html= asset_location;
                        }
                    },
                    _ => warn!("Unknown asset type: {}. Ignoring.", asset_type),
                };
            } else {
                warn!("No assets found despite #+{} specifier.", asset_type);
            }
        } else {
            warn!("No type found despite #+assets specifier.");
        }
    });
    }

    return assets;
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::parsing::deep_parser::tests::get_export_config;

    /// This is a helper structure that is used to compare the
    /// expected output of the initial_parse function.
    struct ExpectedInternalItem {
        key: String,
        metadata: ItemMetadata,
        flavor: ItemFlavor,
        title: Option<Vec<StructuredContent>>,
    }

    macro_rules! assert_org_parse {
        ($test_name:ident, $key:expr, $org_source:expr, $expected:expr $(,)?) => {
            #[test_log::test]
            fn $test_name() {
                let config = get_export_config();
                let parsed = ExpectedInternalItem {
                    key: $key.into(),
                    metadata: extract_metadata(
                        $org_source,
                        &PathBuf::from("."),
                        &PathBuf::from("."),
                    ),
                    flavor: extract_flavor($org_source),
                    title: render_title(&config, $org_source),
                };

                assert_eq!(parsed.key, $expected.key);
                assert_eq!(parsed.metadata, $expected.metadata);
                assert_eq!(parsed.flavor, $expected.flavor);
                assert_eq!(parsed.title, $expected.title);
            }
        };
    }

    assert_org_parse!(
        test_initial_parse_flavor_knowledge,
        "test",
        r#"#+knowledge:
#+title: Test Title
#+access: user1,user2
#+visible
#+dmo: check
#+include: subitem1.org
#+include: subitem2.org"#,
        ExpectedInternalItem {
            key: "test".into(),
            metadata: ItemMetadata {
                visible: true,
                access_rights: vec!["user1".into(), "user2".into()],
                included_items: vec![
                    "subitem1".into(),
                    "subitem2".into()
                ],
                dmos: vec!["check".into()],
                dump_bibliography: None,
            },
            flavor: ItemFlavor::Knowledge,
            title: Some(vec![StructuredContent::Text(
                "Test Title".into()
            )]),
        }
    );

    assert_org_parse!(
        test_initial_parse_flavor_article,
        "SpectreAttacksKocherEtAl",
        r#"
#+access: user1,user2
#+visible
#+dmo: check
#+include: subitem1.org
* NEW \(f:A \rightarrow B\) :desire_one:

test

test
#+include: subitem2.org"#,
        ExpectedInternalItem {
            key: "SpectreAttacksKocherEtAl".into(),
            metadata: ItemMetadata {
                visible: true,
                access_rights: vec!["user1".into(), "user2".into()],
                included_items: vec![
                    "subitem1".into(),
                    "subitem2".into()
                ],
                dmos: vec!["check".into()],
                dump_bibliography: None,
            },
            flavor: ItemFlavor::Article {
                read_state: ArticleState::New,
                desire_state: ArticleState::One,
            },
            title: None,
        }
    );

    assert_org_parse!(
        test_initial_modern_article_format,
        "test",
        r#"
#+reference: new,one
test
test"#,
        ExpectedInternalItem {
            key: "test".into(),
            metadata: ItemMetadata {
                visible: false,
                access_rights: vec![],
                included_items: vec![],
                dmos: vec![],
                dump_bibliography: None,
            },
            flavor: ItemFlavor::Article {
                read_state: ArticleState::New,
                desire_state: ArticleState::One,
            },
            title: None,
        }
    );

    assert_org_parse!(
        test_initial_parse_general_reference,
        "test",
        r#"
#+reference:
test
test"#,
        ExpectedInternalItem {
            key: "test".into(),
            metadata: ItemMetadata {
                visible: false,
                access_rights: vec![],
                included_items: vec![],
                dmos: vec![],
                dump_bibliography: None,
            },
            flavor: ItemFlavor::GeneralReference,
            title: None,
        }
    );
}
