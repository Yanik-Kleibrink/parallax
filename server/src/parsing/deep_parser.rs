use crate::html::citations::HTMLBibliographyAccess;
use crate::html::latex::HTMLLatexExport;
use crate::html::tikz::HTMLTikzExport;
use crate::models::item::CitationInformation;
use crate::models::structured_content::{
    BlockFlavor, ProgressState, StructuredContent, TQFFlavor, Tag,
};
use crate::parsing::regexes::*;

use orgize::ParseConfig;
use orgize::ast::*;
use orgize::rowan::NodeOrToken;
use orgize::rowan::NodeOrToken::Node;
use orgize::rowan::ast::AstNode;
use orgize::{SyntaxElement, SyntaxKind::*};

use xxhash_rust::xxh3::xxh3_64;

use tracing::{debug, error, warn};

use std::collections::HashSet;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::Arc;

/// A configuration that indicates the export configuration of a
/// current item.
///
/// This is usually the private (not default) configuration that
/// therefore also includes private dmo's.
#[derive(Debug, Clone)]
pub struct HTMLExportConfiguration {
    pub bibliography: Arc<dyn HTMLBibliographyAccess + Send + Sync>,
    pub latex: Arc<dyn HTMLLatexExport + Send + Sync>,
    pub tikz: Arc<dyn HTMLTikzExport + Send + Sync>,
}

/// Hash a string into a persistent identifier using xxh3_64.
///
/// This is used by the client to track tags across updates, even if
/// the content of the tag changes. @param raw The string to hash.
fn persistent_id(raw: &str) -> String {
    format!("{}", xxh3_64(raw.as_bytes()))
}

impl HTMLExportConfiguration {
    /// Return the citation information for the given key, if it
    /// exists in the bibliography.
    pub fn extract_citation_information(
        &self,
        key: &str,
    ) -> Option<CitationInformation> {
        self.bibliography.get(key).map(|entry| CitationInformation {
            subtype: entry.html_type(),
            title: entry.html_title(),
            authors: entry.html_authors(),
            year: entry.html_year(),
            month: entry.html_month(),
            day: entry.html_day(),
            location: entry.html_location(),
        })
    }

    /// Hash a set of citation keys into a single u64 hash using
    /// xxh3_64.
    ///
    /// If a citation does not exit the key is hashed directly.
    pub fn hash_citation_abbreviations(
        &self,
        citations: &HashSet<String>,
    ) -> u64 {
        citations.into_iter().fold(0, |hash, citation| {
            hash ^ self
                .bibliography
                .get(&citation)
                .map(|entry| entry.hash_abbreviation())
                .unwrap_or(xxh3_64(citation.as_bytes()))
        })
    }

    /// Hash a single citation key into a u64 hash using xxh3_64.
    ///
    /// If a citation does not exit the key is hashed directly.
    pub fn hash_citation(&self, citation: &str) -> u64 {
        self.bibliography
            .get(citation)
            .map(|entry| entry.hash_all_information())
            .unwrap_or(xxh3_64(citation.as_bytes()))
    }

    /// Add a biblatex entry to the bibliography, returning a new
    /// configuration with the updated bibliography.
    pub fn add_bib(&self, key: &str, biblatex_entry: &str) -> Self {
        HTMLExportConfiguration {
            bibliography: self
                .bibliography
                .add_bib(key, biblatex_entry),
            latex: self.latex.clone(),
            tikz: self.tikz.clone(),
        }
    }

    /// Remove a biblatex entry from the bibliography, returning a new
    /// configuration with the updated bibliography.
    pub fn drop_bib(&self, key: &str) -> Self {
        HTMLExportConfiguration {
            bibliography: self.bibliography.drop_bib(key),
            latex: self.latex.clone(),
            tikz: self.tikz.clone(),
        }
    }

    /// Renders LaTeX and citations in the given text, returning a
    /// vector of StructuredContent.
    fn render_latex_and_citations(
        &self,
        text: &str,
    ) -> Vec<StructuredContent> {
        let mut last_match = 0;
        let mut result = Vec::new();

        for caps in FIND_LATEX_AND_CITATIONS.captures_iter(text) {
            // Push text before the match
            if last_match < caps.get(0).unwrap().start() {
                result.push(StructuredContent::Text(
                    text[last_match..caps.get(0).unwrap().start()]
                        .to_string(),
                ));
            }

            if let Some(complete_match) = caps.name("latex") {
                let rendered_latex = match caps.name("latex") {
                    Some(_) => &self
                        .latex
                        .export(complete_match.into())
                        .or_else(|err| {
                            warn!(
                                complete_match = complete_match.as_str(),
                                error = %err,
                                "Exporting latex failed"
                            );
                            Err("")
                        })
                        .ok()
                        .unwrap_or("<span class='red'>Error rendering latex</span>".to_owned()),
                    None => "",
                };

                result.push(StructuredContent::LaTeX {
                    html: rendered_latex.to_string(),
                });
            }

            if let Some(complete_match) = caps.name("display") {
                let rendered_latex = match caps.name("display") {
                    Some(_) => &self
                        .latex
                        .export_display(complete_match.into())
                        .or_else(|err| {
                            warn!(
                                complete_match = complete_match.as_str(),
                                error = %err,
                                "Exporting display latex failed",
                            );
                            Err("")
                        })
                        .ok()
                        .unwrap_or("<span class='red'>Error rendering latex</span>".to_owned()),
                    None => "",
                };

                result.push(StructuredContent::LaTeX {
                    html: rendered_latex.to_string(),
                });
            }

            if let Some(_) = caps.name("citation") {
                let keys_str =
                    caps.name("keys").map_or("", |m| m.as_str());
                let additive_str =
                    caps.name("additive").map_or("", |m| m.as_str());

                let keys: Vec<(String, String)> = FIND_KEYS
                    .captures_iter(keys_str)
                    .filter_map(|cap| {
                        cap.name("key")
                            .map(|m| m.as_str().to_string())
                    })
                    .map(|key| {
                        (
                            key.clone(),
                            self.bibliography
                                .get(&key)
                                .map(|entity| entity.html_citation())
                                .unwrap_or("??".to_string()),
                        )
                    })
                    .collect();

                result.push(StructuredContent::Citation {
                    post_script: additive_str.to_string(),

                    // NOTE: This could be extended by improving the
                    // regex to capture pre_script if needed.
                    pre_script: String::new(),
                    references: keys,
                });
            }

            last_match = caps.get(0).unwrap().end();
        }

        // Push remaining text
        if last_match < text.len() {
            result.push(StructuredContent::Text(
                text[last_match..].to_string(),
            ));
        }

        result
    }

    /// Extracts the block name from a SpecialBlock element.
    fn extract_block_name(block: &SpecialBlock) -> Option<String> {
        let block_start = block
            .syntax()
            .children()
            .find(|e| e.kind() == BLOCK_BEGIN)
            .into_iter()
            .next()
            .map(|e| e.text().to_string())
            .unwrap_or("".to_owned());
        FIND_BLOCK_NAME
            .captures_iter(&block_start)
            .next()
            .map(|cap| {
                cap.name("name").map(|m| {
                    block_start[m.start()..m.end()].to_owned()
                })
            })
            .flatten()
    }

    /// Parse an org source string into a vector of StructuredContent.
    pub fn parse(&self, org_source: &str) -> Vec<StructuredContent> {
        let parse = ParseConfig {
            todo_keywords: (
                vec![
                    "NEW",
                    "SECOND",
                    "SKIMMED",
                    "READ", // Papers
                    "PROPOSED",
                    "STARTED",
                    "PAUSED",
                    "COMPLETED", // Planning
                    "TODO",
                    "IN PROGRESS",
                    "DONE", // TODO
                    "DISCARDED",
                    "UNSURE",
                    "OPTIMISTIC",
                    "CONFIDENT",
                    "UPGRADED", // Ideas
                    "REMOVED",
                    "FRESH",
                    "POSITIVE",
                    "RELEVANT", // Questions
                ]
                .into_iter()
                .map(|s| s.to_owned())
                .collect(),
                vec![],
            ),
            ..Default::default()
        };

        // There is an incorrect assert in orgize that causes a panic
        // when parsing certain org files. To prevent the entire
        // server from crashing, we catch the panic and log an error
        // instead.
        return match catch_unwind(AssertUnwindSafe(|| {
            parse.parse(org_source)
        })) {
            Ok(org) => org
                .document()
                .syntax()
                .children_with_tokens()
                .flat_map(|c| self.convert_node(&c))
                .collect(),
            Err(err) => {
                tracing::error!(
                    ?err,
                    "orgize panicked while parsing"
                );
                return vec![];
            }
        };
    }

    /// Maps a single direct orgize Element to StructuredContent
    ///
    /// This function can return multiple StructuredContent if for
    /// instance only children should be considered.
    fn convert_node(
        &self,
        element: &SyntaxElement,
    ) -> Vec<StructuredContent> {
        match element {
            SyntaxElement::Node(node) => {
                macro_rules! cast {
                    ($ast:ident) => {{
                        debug_assert!($ast::can_cast(node.kind()));
                        $ast::cast(node.clone()).unwrap()
                    }};
                }

                match node.kind() {
                    HEADLINE => {
                        let h = cast!(Headline);

                        // Titles and children are accessed directly
                        // from the struct now
                        let title = h
                            .title()
                            .flat_map(|c| self.convert_node(&c))
                            .collect::<Vec<_>>();

                        let key = persistent_id(&h.title_raw());

                        let content = h
                            .section()
                            .into_iter()
                            .flat_map(|s| {
                                s.syntax().children_with_tokens()
                            })
                            .chain(h.headlines().into_iter().map(
                                |s| {
                                    NodeOrToken::Node(
                                        s.syntax().clone(),
                                    )
                                },
                            ))
                            .flat_map(|c| self.convert_node(&c))
                            .collect::<Vec<_>>();

                        // Check for entity
                        let entity =
                            h.tags().any(|tag| tag == "entity");

                        if h.tags().any(|tag| tag == "tag") {
                            return vec![StructuredContent::Tag(Tag {
                                title: title,
                                content: h.section()
                                    .into_iter()
                                    .flat_map(|s| s.syntax().children_with_tokens())
                                    .chain(h.headlines().into_iter().map(|s| NodeOrToken::Node(s.syntax().clone())))
                                    .filter(|n| {
                                        match n {
                                            NodeOrToken::Node(n) => {
                                                // Only include headlines that have not been tagged with "tag".
                                                if n.kind() == HEADLINE {
                                                    let h = Headline::cast(n.clone()).unwrap();
                                                    return !h.tags().any(|tag| tag == "tag");
                                                }
                                                else {
                                                    return true;
                                                }
                                            }
                                            NodeOrToken::Token(_) => true,
                                        }
                                    })
                                    .filter(|n| {
                                        // Remove direct include keywords
                                        match n {
                                            NodeOrToken::Node(n) => {
                                                if n.kind() == KEYWORD {
                                                    let k = Keyword::cast(n.clone()).unwrap();
                                                    return !k.raw().to_lowercase().starts_with("#+include:")
                                                }
                                                true
                                            }
                                            NodeOrToken::Token(_) => true,
                                        }
                                    })
                                    .flat_map(|c| {
                                        self.convert_node(&c)
                                    })
                                    .collect::<Vec<_>>(),
                                subtags: h.headlines()
                                    .filter(|h| {
                                        return h.tags().any(|tag| tag == "tag")
                                    })
                                    .flat_map(|h| {
                                        self.convert_node(&Node(h.syntax().clone()))
                                    })
                                    .map(|c| {
                                        if let StructuredContent::Tag(tag) = c {
                                            Some(tag)
                                        } else {
                                            None
                                        }
                                    })
                                    .flatten()
                                    .collect::<Vec<_>>(),
                                key: key,
                                subitems: h.section()
                                    .into_iter()
                                    .flat_map(|s| s.syntax().children_with_tokens())
                                    .flat_map(|n| {
                                        // Only keep direct include keywords
                                        match n {
                                            NodeOrToken::Node(n) => {
                                                if n.kind() == KEYWORD {
                                                    let k = Keyword::cast(n.clone()).unwrap();
                                                    let keyword_line = k.raw();

                                                    match FIND_INCLUDED_FILE
                                                        .captures_iter(&keyword_line)
                                                        .next()
                                                    {
                                                        Some(caps) => {
                                                            match caps.name("basename") {
                                                                Some(m) =>
                                                                    Some(
                                                                        keyword_line
                                                                            [m.start()..m.end()]
                                                                            .into()
                                                                    ),
                                                                _ =>
                                                                    None
                                                            }
                                                        },
                                                        _ => None
                                                    }
                                                }
                                                else {
                                                    None
                                                }
                                            }
                                            NodeOrToken::Token(_) => None,
                                        }
                                    })
                                    .collect::<Vec<_>>()
                            })];
                        }

                        if let Some(keyword) = h.todo_keyword() {
                            let kw = keyword.to_uppercase();
                            match kw.as_str() {
                                // Progress Sections
                                "PROPOSED" => {
                                    return vec![
                                StructuredContent::ProgressSection {
                                    title,
                                    state: ProgressState::Proposed,
                                    content,
                                    entity,
                                    key,
                                },
                            ];
                                }
                                "STARTED" => {
                                    return vec![
                                StructuredContent::ProgressSection {
                                    title,
                                    state: ProgressState::Started,
                                    content,
                                    entity,
                                    key,
                                },
                            ];
                                }
                                "COMPLETED" => {
                                    return vec![
                                StructuredContent::ProgressSection {
                                    title,
                                    state: ProgressState::Completed,
                                    content,
                                    entity,
                                    key,
                                },
                            ];
                                }
                                "PAUSED" => {
                                    return vec![
                                StructuredContent::ProgressSection {
                                    title,
                                    state: ProgressState::Paused,
                                    content,
                                    entity,
                                    key,
                                },
                            ];
                                }
                                _ => {
                                    // Fallback to omitting the
                                    // headline and process the
                                    // children only.
                                    // This ensures proper handling of
                                    // articles which are delineated
                                    // via the READ, ... states.

                                    return node
                                        .children_with_tokens()
                                        .flat_map(|c| {
                                            self.convert_node(&c)
                                        })
                                        .collect::<Vec<_>>();
                                }
                            }
                        }

                        return vec![StructuredContent::Section {
                            title,
                            content,
                            entity,
                            key,
                        }];
                    }
                    PARAGRAPH => {
                        let p = cast!(Paragraph);

                        return vec![StructuredContent::Paragraph {
                            content: p
                                .syntax()
                                .children_with_tokens()
                                .flat_map(|c| self.convert_node(&c))
                                .collect::<Vec<_>>(),
                        }];
                    }
                    BOLD => {
                        let b = cast!(Bold);
                        return vec![StructuredContent::Bold(
                            b.syntax()
                                .children_with_tokens()
                                .flat_map(|c| self.convert_node(&c))
                                .collect::<Vec<_>>(),
                        )];
                    }
                    ITALIC => {
                        let i = cast!(Italic);
                        return vec![StructuredContent::Italic(
                            i.syntax()
                                .children_with_tokens()
                                .flat_map(|c| self.convert_node(&c))
                                .collect::<Vec<_>>(),
                        )];
                    }
                    LINK => {
                        let l = cast!(Link);
                        warn!(
                            text = l.raw(),
                            "Link elements are not yet supported in the export. Skipping link."
                        );

                        return vec![];
                    }
                    SPECIAL_BLOCK => {
                        let b = cast!(SpecialBlock);

                        let flavor_str = Self::extract_block_name(&b)
                            .unwrap_or_else(|| "UNKNOWN".to_string());

                        if flavor_str.to_lowercase() == "name" {
                            // This is a name block, which is handled
                            // in the super block.
                            warn!(
                                "Usage of deprecated name block. Please use #+NAME: in the affiliated keywords instead."
                            );
                            return vec![];
                        }

                        let content = b
                            .syntax()
                            .children_with_tokens()
                            .filter(|c| c.kind() == BLOCK_CONTENT)
                            .flat_map(|c| self.convert_node(&c))
                            .collect::<Vec<_>>();

                        if ["ques", "todo", "fix"].contains(
                            &flavor_str.to_lowercase().as_str(),
                        ) {
                            let flavor = match flavor_str.as_str() {
                                "ques" => TQFFlavor::Question,
                                "todo" => TQFFlavor::Todo,
                                "fix" => TQFFlavor::Fix,
                                _ => {
                                    // This should not happen due to
                                    // the previous check.
                                    // Assert that it never happens.
                                    debug_assert!(
                                        false,
                                        "Unexpected TQF flavor: {}",
                                        flavor_str,
                                    );
                                    TQFFlavor::Todo
                                }
                            };

                            return vec![StructuredContent::TQF {
                                flavor,
                                content,
                            }];
                        }

                        let flavor = match flavor_str.as_str() {
                            "theorem" => BlockFlavor::Theorem,
                            "definition" => BlockFlavor::Definition,
                            "proof" => BlockFlavor::Proof,
                            "proposition" => BlockFlavor::Proposition,
                            "notation" => BlockFlavor::Notation,
                            "demo" => BlockFlavor::Example,
                            "lemma" => BlockFlavor::Lemma,
                            "corollary" => BlockFlavor::Corollary,
                            "remark" => BlockFlavor::Remark,
                            "conjecture" => BlockFlavor::Conjecture,
                            "convention" => BlockFlavor::Convention,
                            "axiom" => BlockFlavor::Axiom,
                            other => BlockFlavor::Unknown(
                                other.to_string(),
                            ),
                        };

                        // Search for label in affiliated keywords
                        let label = b
                            .syntax()
                            .children()
                            .filter(|c| {
                                c.kind() == AFFILIATED_KEYWORD
                            })
                            .filter_map(|c| {
                                let k = AffiliatedKeyword::cast(
                                    c.clone(),
                                )?;
                                if k.raw()
                                    .to_lowercase()
                                    .starts_with("#+label:")
                                {
                                    Some(
                                        k.raw()[8..]
                                            .trim()
                                            .to_string(),
                                    )
                                } else {
                                    None
                                }
                            })
                            .next();

                        let name = b
                            .syntax()
                            .children()
                            .filter(|c| {
                                c.kind() == AFFILIATED_KEYWORD
                            })
                            .filter_map(|c| {
                                let k = AffiliatedKeyword::cast(c)?;
                                if k.raw()
                                    .to_lowercase()
                                    .starts_with("#+name:")
                                {
                                    Some(
                                        self.render_latex_and_citations(
                                        k.raw()[7..]
                                            .trim()
                                        )
                                    )
                                } else {
                                    None
                                }
                            })
                            .next()
                            .or_else(|| b.syntax()
                                .children()
                                .filter(|c| {
                                    c.kind() == BLOCK_CONTENT
                                })
                                     .next()
                                     .map(|c| c.children())
                                     .into_iter()
                                     .flatten()
                                     .filter(|c| c.kind() == SPECIAL_BLOCK)
                                     .filter(|d| d.children()
                                             .filter(|c| {
                                                 if c.kind() == BLOCK_BEGIN {
                                                    if c.text().to_string().to_lowercase().starts_with("#+begin_name") {
                                                        warn!(
                                                            "Usage of deprecated name block. Please use #+NAME: in the affiliated keywords instead."
                                                        );
                                                        true
                                                    }
                                                    else {
                                                        false
                                                    }
                                                }
                                                else {
                                                    false
                                                }
                                            })
                                            .next()
                                            .is_some())
                                     .next()
                                     // The children of the special block are analyzed to forgo the block of rendering special blocks with type name.
                                     .map(|c| c.
                                        children_with_tokens()
                                          .filter(|c| {
                                              c.kind() == BLOCK_CONTENT
                                          })
                                        .flat_map(|c| self.convert_node(&c))
                                        .collect::<Vec<_>>()));

                        return vec![StructuredContent::Block {
                            flavor,
                            content,
                            name,
                            label,
                        }];
                    }
                    AFFILIATED_KEYWORD => {
                        return vec![]; // Affiliated keywords are handled in the context of their parent block, so we skip them here.
                    }
                    KEYWORD => {
                        let k = cast!(Keyword);
                        let keyword_line = k.raw();

                        match FIND_INCLUDED_FILE
                            .captures_iter(&keyword_line)
                            .next()
                        {
                            Some(caps) => {
                                match caps.name("basename") {
                                    Some(m) => {
                                        return vec![StructuredContent::Add(
                                        keyword_line
                                            [m.start()..m.end()]
                                            .into(),
                                    )];
                                    }
                                    _ => {
                                        warn!(
                                            keyword_line,
                                            "Could not find basename in included file keyword"
                                        );
                                        return vec![];
                                    }
                                }
                            }
                            _ => {}
                        };

                        // Todo, Fix, Question
                        match FIND_TQF
                            .captures_iter(&keyword_line)
                            .next()
                        {
                            Some(caps) => {
                                let severity_str =
                                    match caps.name("severity") {
                                        Some(m) => {
                                            &keyword_line
                                                [m.start()..m.end()]
                                        }
                                        _ => "",
                                    };
                                let content =
                                    match caps.name("content") {
                                        Some(m) => {
                                            &keyword_line
                                                [m.start()..m.end()]
                                        }
                                        _ => "",
                                    };
                                let severity = match severity_str
                                    .to_lowercase()
                                    .as_str()
                                {
                                    "ques" => TQFFlavor::Question,
                                    "fix" => TQFFlavor::Fix,
                                    "do" => TQFFlavor::Todo,
                                    _ => {
                                        warn!(
                                            severity_str,
                                            "Unknown TQF severity"
                                        );
                                        TQFFlavor::Todo
                                    }
                                };

                                return vec![StructuredContent::TQF {
                                    flavor: severity,
                                    content: self
                                        .render_latex_and_citations(
                                            content,
                                        ),
                                }];
                            }
                            _ => {
                                warn!(
                                    keyword_line,
                                    "Unknown keyword"
                                );

                                return vec![];
                            }
                        };
                    }
                    LATEX_FRAGMENT => {
                        let l = cast!(LatexFragment);

                        return self
                            .render_latex_and_citations(&l.raw());
                    }
                    COMMENT => {
                        // Comments are ignored in the export.
                        return vec![];
                    }
                    LATEX_ENVIRONMENT => {
                        let l = cast!(LatexEnvironment);
                        if l.raw().contains("tikz") {
                            return vec![StructuredContent::LaTeX {
                                html: self.tikz.render(&l.raw()).unwrap_or_else(
                                        |err| {
                                            warn!(error=%err, "Exporting latex failed");
                                            format!("<pre class='red tikz--error'>{}</pre>", err)
                                        })
                            }
                            ];
                        } else {
                            return vec![StructuredContent::LaTeX {
                                html: self.latex.export_display(&l.raw()).unwrap_or_else(
                                    |err| {
                                        warn!(error=%err, "Exporting latex failed");
                                        "<span class='red'>Error rendering latex</span>".to_string()
                                    })
                            }];
                        }
                    }
                    LIST => {
                        let list = cast!(List);

                        return vec![StructuredContent::Itemize {
                            items: list
                                .items()
                                .map(|item| {
                                    item.syntax()
                                        .children_with_tokens()
                                        .flat_map(|c| {
                                            self.convert_node(&c)
                                        })
                                        .collect::<Vec<_>>()
                                })
                                .collect::<Vec<_>>(),
                        }];
                    }
                    SOURCE_BLOCK => {
                        let s = cast!(SourceBlock);

                        return vec![StructuredContent::Code {
                            content: s.value(),
                            language: s
                                .language()
                                .map(|l| l.to_string()),
                        }];
                    }

                    // All others including list items fall through
                    // and only their children are processed.
                    _ => {
                        return node
                            .children_with_tokens()
                            .flat_map(|c| self.convert_node(&c))
                            .collect::<Vec<_>>();
                    }
                }
            }
            SyntaxElement::Token(token) => {
                if token.kind() == TEXT {
                    return self
                        .render_latex_and_citations(&token.text());
                } else {
                    debug!(
                        token_text = token.text(),
                        token_kind = ?token.kind(),
                        "Unknown token kind"
                    );
                    return vec![];
                }
            }
        }
    }

    /// Dumps the bibliography entries corresponding to the given keys
    /// into a BibTeX file at the specified path.
    ///
    /// @param path The path to the BibTeX file where the bibliography
    /// entries will be written.
    /// @param keys A vector of keys
    /// corresponding to the bibliography entries to be dumped.
    pub fn dump_bibliography(
        &self,
        path: &PathBuf,
        keys: &Vec<String>,
    ) {
        let mut bib: String = r#"
@comment{This file is generated by the parallax export tool. Do not edit manually.}
"#.into();
        for key in keys {
            if let Some(entity) = self.bibliography.get(&key) {
                bib.push_str(&entity.dump());
                bib.push_str("\n");
            } else {
                debug!(key, "Key not found in bibliography");
            }
        }

        std::fs::write(path, bib).unwrap_or_else(|err| {
            error!(error=%err, path=?path, "Failed to write bibliography to file");
        });
    }
}

/// This fast implementation of an equality of HTMLExportConfiguration
/// is used to check if the configuration was changed.
impl PartialEq for HTMLExportConfiguration {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.bibliography, &other.bibliography)
            && Arc::ptr_eq(&self.latex, &other.latex)
            && Arc::ptr_eq(&self.tikz, &other.tikz)
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    use biblatex::Bibliography;

    #[derive(Debug, Clone)]
    pub struct MockHTMLLatexExport {}

    impl MockHTMLLatexExport {
        pub fn create() -> Self {
            MockHTMLLatexExport {}
        }
    }

    impl HTMLLatexExport for MockHTMLLatexExport {
        fn export(
            &self,
            input: &str,
        ) -> Result<String, Box<dyn std::error::Error>> {
            Ok(input.to_string())
        }

        fn export_display(
            &self,
            input: &str,
        ) -> Result<String, Box<dyn std::error::Error>> {
            Ok(input.to_string())
        }

        fn add_dmos(
            &self,
            _dmos: &mut dyn Iterator<Item = String>,
        ) -> Result<
            Arc<dyn HTMLLatexExport + Send + Sync>,
            Box<dyn std::error::Error>,
        > {
            Ok(Arc::new(MockHTMLLatexExport {}))
        }
    }

    #[derive(Debug, Clone)]
    pub struct MockTikzHTMLExport {}

    impl MockTikzHTMLExport {
        pub fn create() -> Self {
            MockTikzHTMLExport {}
        }
    }

    impl HTMLTikzExport for MockTikzHTMLExport {
        fn render(
            &self,
            input: &str,
        ) -> Result<String, Box<dyn std::error::Error>> {
            Ok(input.to_string())
        }

        fn add_dmos(
            &self,
            _dmos: &mut dyn Iterator<Item = String>,
        ) -> Result<
            Arc<dyn HTMLTikzExport + Send + Sync>,
            Box<dyn std::error::Error>,
        > {
            Ok(Arc::new(MockTikzHTMLExport {}))
        }
    }

    pub fn get_export_config() -> HTMLExportConfiguration {
        let src = "@INPROCEEDINGS{SpectreAttacksKocherEtAl,
  author={Kocher, Paul and Horn, Jann and Fogh, Anders and Genkin, Daniel and Gruss, Daniel and Haas, Werner and Hamburg, Mike and Lipp, Moritz and Mangard, Stefan and Prescher, Thomas and Schwarz, Michael and Yarom, Yuval},
  booktitle={2019 IEEE Symposium on Security and Privacy (SP)},
  title={Spectre Attacks: Exploiting Speculative Execution},
  year={2019},
  volume={},
  number={},
  pages={1-19},
  keywords={Program processors;Microarchitecture;Registers;Arrays;Transient analysis;Hardware;Side-channel attacks;Spectre;speculative-execution;microarchitecture-security;microarchitectural-attack},
  doi={10.1109/SP.2019.00002}
  }";
        let bibliography = Bibliography::parse(src).unwrap();

        HTMLExportConfiguration {
            bibliography: Arc::new(bibliography),
            latex: Arc::new(MockHTMLLatexExport::create()),
            tikz: Arc::new(MockTikzHTMLExport::create()),
        }
    }

    macro_rules! assert_org_parse {
        ($test_name:ident, $org_source:expr, $expected:expr $(,)?) => {
            #[test_log::test]
            fn $test_name() {
                let config = get_export_config();
                let parsed = config.parse($org_source);
                assert_eq!(parsed, $expected);
            }
        };
    }

    assert_org_parse!(test_parse_empty, "", vec![]);

    assert_org_parse!(
        test_parse_text,
        "This is a simple text.",
        vec![StructuredContent::Paragraph {
            content: vec![StructuredContent::Text(
                "This is a simple text.".to_string()
            )]
        }]
    );

    assert_org_parse!(
        test_parse_bold,
        "This is *bold* text.",
        vec![StructuredContent::Paragraph {
            content: vec![
                StructuredContent::Text("This is ".to_string()),
                StructuredContent::Bold(vec![
                    StructuredContent::Text("bold".to_string())
                ]),
                StructuredContent::Text(" text.".to_string()),
            ]
        }]
    );

    assert_org_parse!(
        test_parse_italic,
        "This is /italic/ text.",
        vec![StructuredContent::Paragraph {
            content: vec![
                StructuredContent::Text("This is ".to_string()),
                StructuredContent::Italic(vec![
                    StructuredContent::Text("italic".to_string())
                ]),
                StructuredContent::Text(" text.".to_string()),
            ]
        }]
    );

    assert_org_parse!(
        test_parse_latex,
        "This is a LaTeX inline formula: \\(E=mc^2\\).",
        vec![StructuredContent::Paragraph {
            content: vec![
                StructuredContent::Text(
                    "This is a LaTeX inline formula: ".to_string()
                ),
                StructuredContent::LaTeX {
                    html: "E=mc^2".to_string()
                },
                StructuredContent::Text(".".to_string()),
            ]
        }]
    );

    assert_org_parse!(
        test_parse_display_latex,
        "This is a LaTeX display formula: \\[E=mc^2\\].",
        vec![StructuredContent::Paragraph {
            content: vec![
                StructuredContent::Text(
                    "This is a LaTeX display formula: ".to_string()
                ),
                StructuredContent::LaTeX {
                    html: "E=mc^2".to_string()
                },
                StructuredContent::Text(".".to_string()),
            ]
        }]
    );

    assert_org_parse!(
        test_parse_tikz,
        r#"This is a TikZ diagram:
\begin{tikzcd}
  A \arrow[r] \arrow[d] & B \arrow[d] \\
  C \arrow[r] & D
\end{tikzcd}"#,
        vec![
            StructuredContent::Paragraph {
                content: vec![StructuredContent::Text(
                    "This is a TikZ diagram:\n".to_string()
                )]
            },
            StructuredContent::LaTeX {
                html: r#"\begin{tikzcd}
  A \arrow[r] \arrow[d] & B \arrow[d] \\
  C \arrow[r] & D
\end{tikzcd}"#
                    .to_string()
            },
        ]
    );

    assert_org_parse!(
        test_parse_list,
        "- Item 1\n- Item 2\n- Item 3\n",
        vec![StructuredContent::Itemize {
            items: vec![
                vec![StructuredContent::Paragraph {
                    content: vec![StructuredContent::Text(
                        "Item 1\n".to_string()
                    )],
                }],
                vec![StructuredContent::Paragraph {
                    content: vec![StructuredContent::Text(
                        "Item 2\n".to_string()
                    )],
                }],
                vec![StructuredContent::Paragraph {
                    content: vec![StructuredContent::Text(
                        "Item 3\n".to_string()
                    )],
                }],
            ],
        }]
    );

    assert_org_parse!(
        test_parse_section,
        "* Section 1\nThis is a simple section.",
        vec![StructuredContent::Section {
            title: vec![StructuredContent::Text(
                "Section 1".to_string()
            )],
            content: vec![StructuredContent::Paragraph {
                content: vec![StructuredContent::Text(
                    "This is a simple section.".to_string()
                )],
            }],
            entity: false,
            key: "12189364140623502461".to_string(),
        }]
    );

    assert_org_parse!(
        test_parse_progress_section,
        "* PROPOSED Progress Section\nThis is a proposed progress section.",
        vec![StructuredContent::ProgressSection {
            title: vec![StructuredContent::Text(
                "Progress Section".to_string()
            )],
            state: ProgressState::Proposed,
            content: vec![StructuredContent::Paragraph {
                content: vec![StructuredContent::Text(
                    "This is a proposed progress section."
                        .to_string()
                )],
            }],
            entity: false,
            key: "11010554920579375871".to_string(),
        }]
    );

    assert_org_parse!(
        test_parse_tqf,
        "#+do: This is a todo item.",
        vec![StructuredContent::TQF {
            flavor: TQFFlavor::Todo,
            content: vec![StructuredContent::Text(
                " This is a todo item.".to_string()
            )],
        }]
    );

    assert_org_parse!(
        test_parse_block_tqf_question,
        r#"#+begin_ques
This is a question block.
#+end_ques"#,
        vec![StructuredContent::TQF {
            flavor: TQFFlavor::Question,
            content: vec![StructuredContent::Paragraph {
                content: vec![StructuredContent::Text(
                    "This is a question block.\n".to_string()
                )],
            }],
        }]
    );

    assert_org_parse!(
        test_parse_citation_in_title,
        "* Section with citation [cite:@SpectreAttacksKocherEtAl]",
        vec![StructuredContent::Section {
            title: vec![
                StructuredContent::Text(
                    "Section with citation ".to_string()
                ),
                StructuredContent::Citation {
                    post_script: String::new(),
                    pre_script: String::new(),
                    references: vec![(
                        "SpectreAttacksKocherEtAl".to_string(),
                        "KHFG+19".to_string()
                    )],
                },
            ],
            content: vec![],
            entity: false,
            key: "13288877541811652282".to_string(),
        }]
    );

    assert_org_parse!(
        test_parse_citation_in_paragraph,
        "This is a paragraph with a citation [cite:@SpectreAttacksKocherEtAl Hellow].",
        vec![StructuredContent::Paragraph {
            content: vec![
                StructuredContent::Text(
                    "This is a paragraph with a citation "
                        .to_string()
                ),
                StructuredContent::Citation {
                    post_script: " Hellow".to_string(),
                    pre_script: String::new(),
                    references: vec![(
                        "SpectreAttacksKocherEtAl".to_string(),
                        "KHFG+19".to_string()
                    )],
                },
                StructuredContent::Text(".".to_string())
            ],
        }]
    );

    assert_org_parse!(
        test_parse_theorem,
        r#"#+begin_theorem
This is a theorem block.
#+end_theorem"#,
        vec![StructuredContent::Block {
            flavor: BlockFlavor::Theorem,
            content: vec![StructuredContent::Paragraph {
                content: vec![StructuredContent::Text(
                    "This is a theorem block.\n".to_string()
                )],
            }],
            label: None,
            name: None,
        }]
    );

    assert_org_parse!(
        test_parse_definition_with_name_and_label,
        r#"
#+NAME: See also [cite:@SpectreAttacksKocherEtAl]
#+LABEL: def:example
#+begin_definition
This is a definition block.
#+end_definition"#,
        vec![StructuredContent::Block {
            flavor: BlockFlavor::Definition,
            content: vec![StructuredContent::Paragraph {
                content: vec![StructuredContent::Text(
                    "This is a definition block.\n".to_string()
                )],
            }],
            label: Some("def:example".to_string()),
            name: Some(vec![
                StructuredContent::Text("See also ".to_string()),
                StructuredContent::Citation {
                    post_script: String::new(),
                    pre_script: String::new(),
                    references: vec![(
                        "SpectreAttacksKocherEtAl".to_string(),
                        "KHFG+19".to_string()
                    )],
                }
            ]),
        }]
    );

    assert_org_parse!(
        test_parse_definition_with_name_block,
        r#"
#+begin_definition
#+begin_name
See also [cite:@SpectreAttacksKocherEtAl]
#+end_name
This is a definition block.
#+end_definition"#,
        vec![StructuredContent::Block {
            flavor: BlockFlavor::Definition,
            content: vec![StructuredContent::Paragraph {
                content: vec![StructuredContent::Text(
                    "This is a definition block.\n".to_string()
                )],
            }],
            label: None,
            name: Some(vec![StructuredContent::Paragraph {
                content: vec![
                    StructuredContent::Text("See also ".to_string()),
                    StructuredContent::Citation {
                        post_script: String::new(),
                        pre_script: String::new(),
                        references: vec![(
                            "SpectreAttacksKocherEtAl".to_string(),
                            "KHFG+19".to_string()
                        )],
                    },
                    StructuredContent::Text("\n".to_string()),
                ],
            }]),
        }]
    );

    assert_org_parse!(
        test_parse_include,
        r#"
#+include: test.org
"#,
        vec![StructuredContent::Add("test".to_string())]
    );

    assert_org_parse!(
        test_parse_tag,
        r#"
* Test :tag:
Hello!

#+include: test.org

** Test 2 :tag:
#+include: test2.org

#+include: test3.org

* Test 3 :tag:
"#,
        vec![
            StructuredContent::Tag(Tag {
                title: vec![StructuredContent::Text(
                    "Test ".to_string()
                )],
                content: vec![StructuredContent::Paragraph {
                    content: vec![StructuredContent::Text(
                        "Hello!\n".to_string()
                    )]
                },],
                subtags: vec![Tag {
                    title: vec![StructuredContent::Text(
                        "Test 2 ".to_string()
                    )],
                    content: vec![],
                    subtags: vec![],
                    key: "15129327376292691635".to_string(),
                    subitems: vec![
                        "test2".to_string(),
                        "test3".to_string(),
                    ]
                }],
                key: "3655840674573076005".to_string(),
                subitems: vec!["test".to_string()]
            }),
            StructuredContent::Tag(Tag {
                title: vec![StructuredContent::Text(
                    "Test 3 ".to_string()
                )],
                content: vec![],
                subtags: vec![],
                key: "6737545841094050563".to_string(),
                subitems: vec![]
            })
        ]
    );

    assert_org_parse!(
        test_parse_latex_environment_in_item,
        r#"
- Test
  \begin{align*}
  2 + 2
  \end{align*}
"#,
        vec![StructuredContent::Itemize {
            items: vec![vec![
                StructuredContent::Paragraph {
                    content: vec![StructuredContent::Text(
                        "Test\n".to_string()
                    )]
                },
                StructuredContent::LaTeX {
                    html: r#"  \begin{align*}
  2 + 2
  \end{align*}
"#
                    .to_string()
                }
            ]]
        }]
    );

    assert_org_parse!(
        test_parse_nested_sections,
        r#"
* Section 1
** Section 1.1
** Section 1.2
* Section 2
"#,
        vec![
            StructuredContent::Section {
                title: vec![StructuredContent::Text(
                    "Section 1".to_string()
                )],
                content: vec![
                    StructuredContent::Section {
                        title: vec![StructuredContent::Text(
                            "Section 1.1".to_string()
                        )],
                        content: vec![],
                        entity: false,
                        key: "8093015892066002221".to_string(),
                    },
                    StructuredContent::Section {
                        title: vec![StructuredContent::Text(
                            "Section 1.2".to_string()
                        )],
                        content: vec![],
                        entity: false,
                        key: "6796137745864155420".to_string(),
                    },
                ],
                entity: false,
                key: "12189364140623502461".to_string(),
            },
            StructuredContent::Section {
                title: vec![StructuredContent::Text(
                    "Section 2".to_string()
                )],
                content: vec![],
                entity: false,
                key: "12398465853884071036".to_string(),
            }
        ]
    );

    assert_org_parse!(
        test_parse_code_block_with_language,
        r#"
#+begin_src python
for i in range(10):
    print(i)
#+end_src
"#,
        vec![StructuredContent::Code {
            content: "for i in range(10):\n    print(i)\n"
                .to_string(),
            language: Some("python".to_string()),
        }]
    );
}
