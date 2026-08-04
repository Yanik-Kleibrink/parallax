pub mod deep_parser;
pub mod initial_parser;
pub mod regexes;

use crate::models::item::{
    CitationInformation, Item, ItemAsset, ItemFlavor,
};
use crate::models::structured_content::StructuredContent;

use crate::parsing::deep_parser::HTMLExportConfiguration;
use crate::parsing::initial_parser::{
    extract_flavor, extract_metadata, get_assets,
    get_content_in_article, render_title,
};

use tracing::{debug, instrument};

use std::collections::HashSet;
use std::error::Error;

use futures_util::future::Either;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use xxhash_rust::xxh3::xxh3_64;

/// This is the error type for the JSON export of the HTML export.
#[derive(Debug, Error)]
pub enum ExportError {
    #[error(
        "No export present. Exporting requires a mutable reference to Item."
    )]
    NoExportPresent,
}

/// This is global metadata of the item that is never exposed to the
/// clients but rather used internally for parsing and access control.
#[derive(Debug, PartialEq)]
pub struct ItemMetadata {
    /// These are the items included into the current item. This
    /// vector is used by the item manager to pass access rights down
    /// to children.
    pub included_items: Vec<String>,

    /// These are the specific groups that have been explicitly
    /// granted access to the current item. It does not include
    /// inherited access rights. These are determined per user
    /// request.
    pub access_rights: Vec<String>,

    /// When set to true (default is false), top_level items are
    /// visible (but not accessible) to all regardless of whether
    /// they are actually accessible. In particular, assets like
    /// papers are exposed.
    pub visible: bool,

    /// These are the citations that are referenced in the item.
    ///
    /// Note that this includes the citation that is associated with
    /// the item itself. This field is used to determine the hash
    /// of the item and to determine whether an update to a
    /// citation should trigger a reexport of the item.
    pub referenced_citations: HashSet<String>,

    /// Local declare math operators
    ///
    /// As these are used to modify and adjust the export
    /// configuration, they need to be determined before the orgize
    /// parse.
    dmos: Vec<String>,

    /// If this is set, then the bibliography is dumped to the
    /// specified path.
    dump_bibliography: Option<PathBuf>,
}

/// This is the internal representation of assets that is associated
/// with an item.
#[derive(Debug)]
pub struct InternalItemAsset {
    /// In case the item explicitly links a local file, then this is
    /// the path to the local file.
    ///
    /// Note that this cannot be set at the same time as the remote
    /// URL.
    local: Option<PathBuf>,

    /// These are links that are inferred using their name.
    local_linked: HashSet<PathBuf>,

    /// In case the item explicitly links a remote file, then this is
    /// the URL to the remote file.
    ///
    /// Note that this cannot be set at the same time as the local
    /// path.
    remote: Option<String>,
}

impl InternalItemAsset {
    pub fn new() -> Self {
        InternalItemAsset {
            local: None,
            local_linked: HashSet::new(),
            remote: None,
        }
    }

    /// Return the path to the asset that the server should use to
    /// serve the asset to the clients.
    ///
    /// In case a local path is specified, then this selects the
    /// preferred path. If no local path is specified, then this
    /// returns None. If a remote URL is specified, then this
    /// returns None as well.
    pub fn preferred_path(&self) -> Option<PathBuf> {
        if let Some(local) = &self.local {
            Some(local.clone())
        } else if let Some(_) = &self.remote {
            None
        } else {
            // Return the longest / deepest path in the local linked
            // paths. This is a heuristic to select the most specific
            // path.
            self.local_linked
                .iter()
                .max_by_key(|p| p.as_os_str().len())
                .cloned()
        }
    }

    /// This returns the external representation of the asset.
    pub fn external_item_asset(&self) -> Option<ItemAsset> {
        if let Some(_) = &self.local {
            Some(ItemAsset::Local)
        } else if *&self.local_linked.len() > 0 {
            Some(ItemAsset::Local)
        } else if let Some(remote) = &self.remote {
            Some(ItemAsset::Remote(remote.clone()))
        } else {
            None
        }
    }

    /// Sets the local path of the asset.
    pub fn set_local(&mut self, local: PathBuf) {
        self.local = Some(local);
    }

    /// Sets the remote URL of the asset.
    pub fn set_remote(&mut self, remote: String) {
        self.remote = Some(remote);
    }

    /// Adds a local linked path to the list of local linked paths.
    pub fn add_local_linked(&mut self, local_linked: &PathBuf) {
        self.local_linked.insert(local_linked.into());
    }

    /// Removes a local linked path from the list of local linked
    /// paths.
    pub fn remove_local_linked(&mut self, local_linked: &PathBuf) {
        self.local_linked.remove(local_linked);
    }
}

/// The internal representation of an item.
#[derive(Debug)]
pub struct InternalItem {
    pub key: String,

    /// The path to the org file that is used to parse the item.
    ///
    /// This is relevant for evaluating the relative paths of the
    /// included assets.
    pub path: PathBuf,

    /// The base path of the base that this item is located in.
    base_path: Arc<PathBuf>,

    /// This is the org content that should be parsed.
    org_content: String,

    // The metadata is not visible to the clients.
    pub metadata: ItemMetadata,

    /// The flavor of the item, e.g., whether it is a knowledge item,
    /// a view, a research project, etc.
    pub flavor: ItemFlavor,

    /// The hash of the export.
    ///
    /// It include the hash of the org content, the hash of the
    /// referenced citations, and the hash of the citation associated
    /// with the item. Crucially, this hash can be computed
    /// without having to perform an export. This is important for
    /// performance reasons, as the export can be expensive.
    hash_export: u64,

    /// The title of the item, which is only relevant for top-level
    /// items.
    ///
    /// Note that it is parsed using the global default config
    /// (specified in the server configuration) This ensures that
    /// a local HTML export configuration does not need to be
    /// available to obtain the title of the item.
    title: Option<Arc<Vec<StructuredContent>>>,

    /// The export configuration
    export_config: HTMLExportConfiguration,

    /// The export result.
    ///
    /// It is unset when the export configuration is changed and only
    /// set when an export is triggered. It is used to determine
    /// whether a reexport is necessary when the export configuration
    /// is changed.
    export: Option<Arc<Vec<StructuredContent>>>,

    /// When the item flavor is an article and an export
    /// configuration is present, then this contains the citation
    /// information for the article.
    citation_information: Option<CitationInformation>,

    /// The PDF export of the item.
    pub pdf: InternalItemAsset,

    /// The HTML export of the item.
    pub html: InternalItemAsset,

    /// The video export of the item.
    pub video: InternalItemAsset,
}

/// Implementation of an internal item
impl InternalItem {
    /// Creates a new internal item with the given key and path.
    #[instrument(fields(key = key))]
    pub fn new(
        key: &str,
        path: &PathBuf,
        base_path: Arc<PathBuf>,
        export_config: HTMLExportConfiguration,
    ) -> Self {
        InternalItem {
            key: key.to_string(),
            path: path.into(),
            base_path: base_path.clone(),
            org_content: "".into(),
            metadata: ItemMetadata {
                included_items: Vec::new(),
                access_rights: Vec::new(),
                visible: false,
                dmos: Vec::new(),
                dump_bibliography: None,
                referenced_citations: HashSet::new(),
            },
            flavor: ItemFlavor::Constituent,
            hash_export: 0,
            title: None,
            export_config: export_config,
            export: None,
            citation_information: None,
            pdf: InternalItemAsset::new(),
            video: InternalItemAsset::new(),
            html: InternalItemAsset::new(),
        }
    }

    /// This function checks whether the export configuration needs to
    /// be updated.
    ///
    /// This comparison is inexpensive.
    #[instrument(skip(self), fields(self.key = %self.key))]
    pub fn update_export_config_necessary(
        &self,
        new_export_config: &HTMLExportConfiguration,
    ) -> bool {
        self.export_config != *new_export_config
    }

    /// Sets the new html export config (including bibliography and
    /// latex) to the provided.
    #[instrument(skip(self), fields(self.key = %self.key))]
    pub fn update_export_config(
        &mut self,
        new_export_config: HTMLExportConfiguration,
    ) -> Result<(), Box<dyn Error>> {
        debug!("Adding a new export config");
        let mut new_export_config = new_export_config.clone();
        new_export_config.latex = new_export_config.latex.add_dmos(
            &mut self
                .metadata
                .dmos
                .iter()
                .map(String::from)
                .into_iter(),
        )?;
        new_export_config.tikz = new_export_config.tikz.add_dmos(
            &mut self
                .metadata
                .dmos
                .iter()
                .map(String::from)
                .into_iter(),
        )?;
        self.export_config = new_export_config;
        self.export = None;
        self.citation_information = None;

        self.compute_hash_export();

        Ok(())
    }

    /// This function updates the org content of the item and triggers
    /// a reparse of the metadata and assets.
    #[instrument(skip(self, new_org_content), fields(self.key = %self.key))]
    pub fn update_org_content(&mut self, new_org_content: &str) {
        debug!("Updating the org content");

        self.flavor = extract_flavor(&new_org_content);
        self.org_content = match self.flavor {
            ItemFlavor::Article { .. } => {
                get_content_in_article(&new_org_content)
            }
            _ => new_org_content.into(),
        };

        let old_included_items = self.metadata.included_items.clone();
        let old_dmos = self.metadata.dmos.clone();
        self.initial_parse();

        if old_included_items != self.metadata.included_items {
            if let Some(path) = &self.metadata.dump_bibliography {
                debug!("Dumping bibliography to {}", path.display());
                self.export_config.dump_bibliography(
                    path,
                    &self.metadata.included_items,
                );
            }
        }

        if old_dmos != self.metadata.dmos {
            debug!("Updating export config with new dmos");
            self.update_export_config(self.export_config.clone())
                .unwrap();
        }

        self.compute_hash_export();
    }

    /// This is the initial parse of the org content that extracts the
    /// metadata and the assets.
    #[instrument(skip(self), fields(self.key = %self.key))]
    fn initial_parse(&mut self) {
        self.metadata = extract_metadata(
            &self.org_content,
            &self.path,
            &self.base_path,
        );

        let assets = get_assets(
            &self.org_content,
            &self.path,
            &self.base_path,
        );
        match assets.pdf {
            Some(Either::Left(path)) => self.pdf.set_local(path),
            Some(Either::Right(url)) => self.pdf.set_remote(url),
            None => {}
        }
        match assets.html {
            Some(Either::Left(path)) => self.html.set_local(path),
            Some(Either::Right(url)) => self.html.set_remote(url),
            None => {}
        }
        match assets.video {
            Some(Either::Left(path)) => self.video.set_local(path),
            Some(Either::Right(url)) => self.video.set_remote(url),
            None => {}
        }
    }

    /// This registers a new PDF that is linked to the item.
    #[instrument(skip(self), fields(self.key = %self.key))]
    pub fn register_pdf(&mut self, pdf_path: &PathBuf) {
        debug!("Registering a new PDF");
        self.pdf.add_local_linked(pdf_path);
    }

    /// This drops a PDF that is linked to the item.
    #[instrument(skip(self), fields(self.key = %self.key))]
    pub fn drop_pdf(&mut self, pdf_path: &PathBuf) {
        debug!("Dropping the PDF");
        self.pdf.remove_local_linked(pdf_path);
    }

    /// This returns the local linked pdfs of the item that were not
    /// directly specified inside the org content.
    ///
    /// When an Item is destroyed (e.g., the backing org file is
    /// deleted), then these pdfs need to be returned to the unmatched
    /// pool in case the org document is recreated.
    pub fn local_linked_pdfs(&self) -> HashSet<PathBuf> {
        self.pdf.local_linked.clone()
    }

    // Currently, video and html are only registered via the file
    // itself.

    /// Trigger an HTML export with the currently registered html
    /// export configuration.
    ///
    /// Note that this also renders the title.
    #[instrument(skip(self), fields(self.key = %self.key))]
    pub fn export(&mut self) -> Result<(), Box<dyn Error>> {
        self.export = Some(Arc::new(
            self.export_config.parse(&self.org_content),
        ));
        self.title =
            render_title(&self.export_config, &self.org_content);

        if matches!(
            self.flavor,
            ItemFlavor::Article { .. } | ItemFlavor::GeneralReference
        ) {
            self.citation_information = self
                .export_config
                .extract_citation_information(&self.key);

            // If the title is not set, then we set it to the title of
            // the article.
            if self.title.is_none()
                && self.citation_information.is_some()
            {
                self.title = Some(Arc::new(
                    self.export_config.parse(
                        &self
                            .citation_information
                            .as_ref()
                            .unwrap()
                            .title,
                    ),
                ));
            }
        }

        Ok(())
    }

    /// This recomputes the hash of the export and stores it in the
    /// item.
    fn compute_hash_export(&mut self) {
        let mut hash: u64 = 0;
        hash ^= xxh3_64(self.org_content.as_bytes());
        hash ^= self.export_config.hash_citation_abbreviations(
            &self.metadata.referenced_citations,
        );
        hash ^= self.export_config.hash_citation(&self.key);

        self.hash_export = hash;
    }

    /// This returns the hash of the item.
    ///
    /// In comparison to the hash of the export it also includes the
    /// referenced assets.
    pub fn hash(&self) -> u64 {
        self.hash_export
            ^ self
                .pdf
                .external_item_asset()
                .map(|asset| asset.hash())
                .unwrap_or(0)
            ^ self
                .html
                .external_item_asset()
                .map(|asset| asset.hash())
                .unwrap_or(0)
            ^ self
                .video
                .external_item_asset()
                .map(|asset| asset.hash())
                .unwrap_or(0)
    }

    /// Obtain the external representation of the item.
    #[instrument(skip(self), fields(self.key = %self.key))]
    pub fn external_item(&self) -> Result<Item, ExportError> {
        if let Some(export) = &self.export {
            Ok(Item {
                key: self.key.clone(),
                flavor: self.flavor.clone(),
                title: self.title.clone(),
                content: export.clone(),
                citation_information: self
                    .citation_information
                    .clone(),
                hash: self.hash(),
                pdf: self.pdf.external_item_asset(),
                html: self.html.external_item_asset(),
                video: self.video.external_item_asset(),
            })
        } else {
            Err(ExportError::NoExportPresent)
        }
    }
}
