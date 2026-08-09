use crate::models::item::{Item, ItemFlavor, ItemFreshness};
use crate::parsing::deep_parser::HTMLExportConfiguration;
use crate::parsing::{ExportError, InternalItem};

use dashmap::DashMap;
use dashmap::mapref::one::MappedRef;
use dashmap::mapref::one::Ref;
use std::collections::{HashSet, VecDeque};

use actix_web::web;
use futures_util::future::join_all;
use std::fs;
use std::io::Error;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast::{self, Sender};
use tokio::task::JoinHandle;

use tracing::{debug, error, info, instrument};

/// This structure augments an internal item with the access rights of
/// the item.
///
/// Note that contrary to the access rights stored in the internal
/// item metadata, the access rights here also contain the propagated
/// access rights from higher-level items. Recall that access rights
/// are always propagated to children.
struct ItemWithAccess {
    item: InternalItem,
    groups: HashSet<String>,
}

impl ItemWithAccess {
    /// Create a new item with no access rights.
    fn new(item: InternalItem) -> ItemWithAccess {
        ItemWithAccess {
            item: item,
            groups: HashSet::new(),
        }
    }

    fn check_access_right(&self, group: &str) -> bool {
        group == "wheel" || self.groups.contains(group)
    }

    /// Add one group to the access rights.
    fn add_access_right(&mut self, group: &str) {
        self.groups.insert(group.into());
    }

    /// Clear all groups from access rights.
    fn clear_access_rights(&mut self) {
        self.groups = HashSet::new();
    }
}

/// This enum is used to notify item watchers of changes to items.
///
/// Note that the (external) item is not immediately sent, so that the
/// events can be debounced and the item can be retrieved when
/// necessary. In particular, exports will not be triggered when no
/// websocket is connected to the server.
#[derive(Debug, Clone)]
pub enum ItemChange {
    Remove(String),
    Update(String),
}

/// This is the main structure used to manage items.
///
/// Note that it is intentionally parallelized.
pub struct ItemDatabase {
    /// The base path where the items are stored. This is used to
    /// resolve relative paths.
    base_path: Arc<PathBuf>,

    /// Whether to allow assets to be outside of the base path. This
    /// can be useful but is significantly more insecure.
    allow_outside_assets: bool,

    /// The database of items. The key is the name of the item, and
    /// the value is the item itself.
    db: DashMap<String, ItemWithAccess>,

    /// The access rights of some items might be incorrect.
    privileges_unsafe: AtomicBool,

    /// The default html export configuration. This is used to
    /// register the html exporter for new items.
    html_export_config: RwLock<HTMLExportConfiguration>,

    /// Unmatched PDFs that have been founded but not yet matched to
    /// an item.
    ///
    /// The key is the name of the PDF file, and the value is the
    /// path to the PDF file.
    unmatched_pdfs: DashMap<String, HashSet<PathBuf>>,

    /// This is a channel that is used to notify item watchers of
    /// updates to items.
    ///
    /// It can be cloned by item watchers and new websockets
    /// subscribe to it.
    item_update_sender: Arc<Sender<ItemChange>>,

    /// A handle to the global bibliography dump task.
    dump_bib_task: RwLock<Option<JoinHandle<()>>>,

    /// Does the global bibliography dump need to be triggered? This
    /// is set to true when a new bib file is added or an existing
    /// bib file is removed.
    dump_bib_necessary: AtomicBool,
}

impl ItemDatabase {
    /// Create an empty ItemDatabase.
    pub fn new(
        base_path: &PathBuf,
        allow_outside_assets: bool,
        html_export_config: HTMLExportConfiguration,
    ) -> Self {
        // Create broadcast channel
        let (tx, _) = broadcast::channel(512);
        Self {
            base_path: Arc::new(base_path.clone()),
            allow_outside_assets,
            db: DashMap::new(),
            privileges_unsafe: AtomicBool::new(false),
            html_export_config: RwLock::new(html_export_config),
            unmatched_pdfs: DashMap::new(),
            item_update_sender: Arc::new(tx),
            dump_bib_task: RwLock::new(None),
            dump_bib_necessary: AtomicBool::new(true),
        }
    }

    /// Start the global bibliography dump task.
    ///
    /// @param dump_path The path where the global bibliography dump
    /// will be written to.
    pub fn start_global_bibliography_dump(
        self: Arc<Self>,
        dump_path: &PathBuf,
    ) -> Result<(), Error> {
        let mut dump_task = self.dump_bib_task.write().unwrap();
        if dump_task.is_some() {
            error!("Global bibliography dump task already started");
            return Err(Error::new(
                std::io::ErrorKind::AlreadyExists,
                "Global bibliography dump task already started",
            ));
        }

        if !dump_path.exists() {
            if dump_path.parent().is_none() {
                error!(
                    dump_path = ?dump_path.display(),
                    "Dump path is not a valid file path",
                );
                return Err(Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!(
                        "Dump path {} is not a valid file path",
                        dump_path.display()
                    ),
                ));
            } else {
                info!(
                    dump_path = ?dump_path.display(),
                    "Dump path does not exist, creating it",
                );
                // Create the file
                if let Err(err) = fs::File::create(dump_path) {
                    error!(
                        dump_path = ?dump_path.display(),
                        error = %err,
                        "Failed to create dump file",
                    );
                    return Err(Error::new(
                        std::io::ErrorKind::InvalidInput,
                        format!(
                            "Failed to create dump file {}: {}",
                            dump_path.display(),
                            err
                        ),
                    ));
                }
            }
        }

        let dump_path = dump_path.canonicalize();
        if let Ok(dump_path) = dump_path {
            let self_clone = Arc::clone(&self);
            let handle = tokio::spawn(async move {
                loop {
                    tokio::time::sleep(
                        std::time::Duration::from_secs(10),
                    )
                    .await;

                    if self_clone
                        .dump_bib_necessary
                        .load(Ordering::SeqCst)
                    {
                        // Get export config
                        let export_config = self_clone
                            .html_export_config
                            .read()
                            .unwrap()
                            .clone();

                        self_clone
                            .dump_bib_necessary
                            .store(false, Ordering::SeqCst);
                        info!(dump_path = ?dump_path, "Dumping bibliography");
                        if let Err(err) = fs::write(
                            &dump_path,
                            export_config.bibliography.dump(),
                        ) {
                            error!(error = %err, "Dumping bibliography failed");
                        }
                    } else {
                        info!(
                            "Global bibliography dump not necessary, skipping"
                        );
                    }
                }
            });

            *dump_task = Some(handle);
            Ok(())
        } else {
            error!("Failed to canonicalize dump path");
            Err(Error::new(
                std::io::ErrorKind::InvalidInput,
                "Failed to canonicalize dump path",
            ))
        }
    }

    /// Stop the global bibliography dump task.
    pub fn stop_global_bibliography_dump(&self) {
        if let Some(handle) =
            self.dump_bib_task.write().unwrap().take()
        {
            handle.abort();
        }
    }

    pub fn get_item_update_sender(&self) -> Arc<Sender<ItemChange>> {
        Arc::clone(&self.item_update_sender)
    }

    /// Remove an item from the database.
    ///
    /// This function should be invoked when the path of an org file
    /// changed or the org file was deleted. It will also remove the
    /// access rights of all children of the removed item.
    #[instrument(skip(self), fields(name = %name))]
    pub fn remove(&self, name: &str) -> Result<(), Error> {
        info!("Removing item");
        if let Some((key, item_with_access)) = self.db.remove(name) {
            // Add the pdfs of the removed item to the unmatched pdfs.
            self.unmatched_pdfs.insert(
                name.into(),
                item_with_access
                    .item
                    .local_linked_pdfs()
                    .into_iter()
                    .collect(),
            );

            // If the removed item had access rights, then we need to
            // set the privileges_unsafe flag to true.
            if item_with_access.item.metadata.access_rights.len() != 0
            {
                self.privileges_unsafe.store(true, Ordering::SeqCst);
            }

            // The only error that is logged exists when there are no
            // receivers, which is not a problem.
            let _ =
                self.item_update_sender.send(ItemChange::Remove(key));

            Ok(())
        } else {
            error!(name, "Item not found");
            Err(Error::new(
                std::io::ErrorKind::NotFound,
                format!("Item {name} not found"),
            ))
        }
    }

    /// Insert or update an item.
    ///
    /// This will also insert the default html_exporter everywhere.
    #[instrument(skip(self), fields(name = %name, path = %path.display()))]
    pub fn add(
        &self,
        name: &str,
        path: &PathBuf,
    ) -> Result<(), Error> {
        info!("Adding item");
        let export_config =
            self.html_export_config.read().unwrap().clone();

        // Get content of org file.
        let org = match fs::read_to_string(path) {
            Ok(org) => org,
            Err(err) => {
                error!(error = %err, "Failed to read org file");
                return Err(err);
            }
        };

        // Check if item already exists.
        if let Some(mut item_with_access) = self.db.get_mut(name) {
            // Check if the path is the same
            if item_with_access.item.path != *path {
                // Note that this cannot happen if the previouw item
                // was deleted.
                error!("Item already exists with a different path.",);
                return Err(Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    format!(
                        "Item {name} already exists with a different path: {:?}",
                        item_with_access.item.path
                    ),
                ));
            }

            // Store the old access rights before updating the item.
            // If they change, then we need to set the
            // privileges_unsafe flag to true.
            let old_access_rights =
                item_with_access.item.metadata.access_rights.clone();

            // Update the item.
            item_with_access.item.update_org_content(&org);

            if item_with_access.item.metadata.access_rights
                != old_access_rights
            {
                self.privileges_unsafe.store(true, Ordering::SeqCst);
            }
        } else {
            // Otherwise, a new item is created and inserted.
            let mut item = InternalItem::new(
                name,
                path,
                self.base_path.clone(),
                &export_config,
            );
            item.update_org_content(&org);

            self.db.insert(name.into(), ItemWithAccess::new(item));

            // Now, get all unmatched pdfs that match the name of the
            // item and register them with the item. (This
            // is done after the item is inserted, so that no new pdfs
            // are inserted into the unmatched list.)
            if let Some(mut unmatched_pdfs) =
                self.unmatched_pdfs.remove(name)
            {
                for pdf_path in unmatched_pdfs.1.drain() {
                    if let Some(mut item_access) =
                        self.db.get_mut(name)
                    {
                        item_access.item.register_pdf(&pdf_path);
                    }
                }
            }
        }

        // Inform the item watchers that an item has been updated.
        // The only error that is logged exists when there are no
        // receivers, which is not a problem.
        let _ = self
            .item_update_sender
            .send(ItemChange::Update(name.into()));

        Ok(())
    }

    /// Retrieves the names of all top-level items visible by a member
    /// of group.
    pub fn names_top_level_items_for_group(
        &self,
        group: &str,
    ) -> impl Iterator<Item = String> {
        let group = String::from(group);
        self.db
            .iter()
            .filter(move |r| {
                r.item.metadata.visible
                    || r.check_access_right(&group)
            })
            .map(|r| r.key().clone())
    }

    /// Retrieves the names of all top-level items.
    fn names_top_level_items(&self) -> impl Iterator<Item = String> {
        self.db
            .iter()
            .filter(|r| {
                r.value().item.flavor != ItemFlavor::Constituent
            })
            .map(|r| r.key().clone())
    }

    /// Unconditionally walks the database and sets the access rights
    /// of all items starting from the top-level ones.
    async fn set_access_rights(self: &Arc<Self>) {
        // Clear the current access rights of all entries
        self.db.iter_mut().for_each(|mut item_access| {
            item_access.clear_access_rights()
        });

        // Find top-level items
        let top_level_names_handles =
            self.names_top_level_items().map(|name| {
                let items = Arc::clone(self);

                web::block(move || {
                    // Need to check if top-level entry still exists
                    // as async.
                    if let Some(top_level_item_access) =
                        items.db.get(&name)
                    {
                        // Retrieve access rights of top-level entry
                        let top_access_rights =
                            &top_level_item_access
                                .item
                                .metadata
                                .access_rights;

                        if top_access_rights.len() != 0 {
                            // Walk items from top and add privileges
                            // as necessary
                            let mut queue: VecDeque<String> =
                                VecDeque::new();

                            queue.push_back(String::from(name));

                            while let Some(name) = queue.pop_front() {
                                info!("Setting privileges");

                                if let Some(mut item_access) =
                                    items.db.get_mut(&name)
                                {
                                    if item_access.item.flavor
                                        != ItemFlavor::Constituent
                                    {
                                        item_access
                                            .item
                                            .metadata
                                            .included_items
                                            .iter()
                                            .for_each(|name| {
                                                queue.push_back(
                                                    name.into(),
                                                );
                                            });
                                        for group in
                                            top_access_rights.iter()
                                        {
                                            item_access
                                                .add_access_right(
                                                    group,
                                                );
                                        }
                                    }
                                }
                            }
                        }
                    }
                })
            });

        for r in join_all(top_level_names_handles).await.into_iter() {
            if let Err(err) = r {
                error!(
                    error=%err,
                    "Joining tasks in set_access_rights yielded error"
                );
            }
        }

        self.privileges_unsafe.store(true, Ordering::SeqCst);
    }

    /// Only alters the access rights if some change caused the
    /// associated flag to be set.
    async fn set_access_rights_if_necessary(self: &Arc<Self>) {
        if self.privileges_unsafe.load(Ordering::SeqCst) {
            self.set_access_rights().await;
        }
    }

    /// Returns the requested item if the access rights have been
    /// granted.
    async fn retrieve<'a>(
        self: &'a Arc<Self>,
        name: &str,
        group: &str,
    ) -> Option<MappedRef<'a, String, ItemWithAccess, InternalItem>>
    {
        self.set_access_rights_if_necessary().await;
        self.db
            .get(name)
            .map(|item_access| {
                info!(
                    name = item_access.key(),
                    groups = ?item_access.groups,
                    "Retrieved item with access rights"
                );
                item_access
            })
            .filter(|ia| ia.check_access_right(&group))
            .map(|ia| Ref::map(ia, |v| &v.item))
    }

    /// Returns the requested item's item struct if the access rights
    /// have been granted.
    ///
    /// If the item hasn't been exported but an export configuration
    /// was set, then a new export is also triggered.
    pub async fn retrieve_item(
        self: &Arc<Self>,
        name: &str,
        group: &str,
    ) -> Option<Item> {
        debug!("Retrieving item");

        // This first if also ensures that group is allowed to access
        // the item.
        if let Some(item) = self.retrieve(name, group).await {
            // Update item with new export if necessary.
            let export_config =
                self.html_export_config.read().unwrap().clone();
            if !item.update_export_config_necessary(&export_config) {
                match item.external_item() {
                    Ok(external_item) => {
                        return Some(external_item.clone());
                    }
                    Err(ExportError::NoExportPresent) => {
                        // Continue...
                    }
                };
            }

            drop(item); // Release the read lock before acquiring a write lock.
            if let Some(mut item) = self.db.get_mut(name) {
                debug!("Exporting item to HTML.");
                if item
                    .item
                    .update_export_config_necessary(&export_config)
                {
                    item.item
                        .update_export_config(export_config)
                        .ok()?;
                }
                item.item.export().ok()?;

                return item.item.external_item().ok().clone();
            } else {
                return None;
            }
        }
        None
    }

    /// Check if the requested item is accessible by the given group.
    pub async fn check_item_accessibility(
        self: &Arc<Self>,
        name: &str,
        group: &str,
    ) -> bool {
        self.set_access_rights_if_necessary().await;
        self.db
            .get(name)
            .map(|item_access| item_access.check_access_right(group))
            .unwrap_or(false)
    }

    pub fn item_updates(&self, group: &str) -> Vec<ItemFreshness> {
        self.db
            .iter()
            .filter(|item_access| {
                item_access.check_access_right(group)
            })
            .map(|item| ItemFreshness {
                key: item.item.key.clone(),
                hash: item.item.hash(),
                flavor: item.item.flavor,
            })
            .collect::<Vec<_>>()
    }

    /// Register a pdf with the system.
    ///
    /// If a matching item is found, then the pdf is registered with
    /// the item. Otherwise, it is stored in the unmatched pdfs.
    #[instrument(skip(self), fields(name = %name, path = %path.display()))]
    pub fn register_pdf(&self, name: &str, path: &PathBuf) {
        if let Some(mut item_access) = self.db.get_mut(name) {
            item_access.item.register_pdf(path);

            let _ = self
                .item_update_sender
                .send(ItemChange::Update(name.into()));
        } else {
            if let Some(mut unmatched_pdfs) =
                self.unmatched_pdfs.get_mut(name)
            {
                unmatched_pdfs.insert(path.into());
            } else {
                let mut pdfs = HashSet::new();
                pdfs.insert(path.into());
                self.unmatched_pdfs.insert(name.into(), pdfs);
            }
        }
    }

    /// Drop a PDF from an item. If the item does not exist, then the
    /// PDF is removed from the unmatched PDFs.
    #[instrument(skip(self), fields(name = %name, path = %path.display()))]
    pub fn drop_pdf(&self, name: &str, path: &PathBuf) {
        if let Some(mut item_access) = self.db.get_mut(name) {
            item_access.item.drop_pdf(path);

            let _ = self
                .item_update_sender
                .send(ItemChange::Update(name.into()));
        } else {
            self.unmatched_pdfs.remove(name);
        }
    }

    /// Add a bib file to the system.
    #[instrument(skip(self), fields(name = %name, path = %path.display()))]
    pub fn add_bib(&self, name: &str, path: &PathBuf) {
        let export_config =
            self.html_export_config.read().unwrap().clone();
        match fs::read_to_string(path) {
            Ok(bib_content) => {
                // Update the export configuration.
                // Note that it is only propagated to a child when
                // that item is retrieved.
                *(self.html_export_config.write().unwrap()) =
                    export_config.add_bib(name, &bib_content);
            }
            Err(_) => {
                error!("Failed to read bib file.");
            }
        }

        self.dump_bib_necessary.store(true, Ordering::SeqCst);

        self.db.iter().for_each(|item_access| {
            if item_access
                .item
                .metadata
                .referenced_citations
                .contains(name)
            {
                // The only error that is logged exists when there are
                // no receivers, which is not a problem.
                let _ = self.item_update_sender.send(
                    ItemChange::Update(item_access.key().clone()),
                );
            }
        });

        let _ = self
            .item_update_sender
            .send(ItemChange::Remove(name.into()));
    }

    /// Drop a bib file from the system.
    #[instrument(skip(self), fields(name = %name))]
    pub fn drop_bib(&self, name: &str) {
        let export_config =
            self.html_export_config.read().unwrap().clone();
        {
            // Update the export configuration.
            // Note that it is only propagated to a child when that
            // item is retrieved.
            *(self.html_export_config.write().unwrap()) =
                export_config.drop_bib(name);
        }
        self.dump_bib_necessary.store(true, Ordering::SeqCst);

        self.db.iter().for_each(|item_access| {
            if item_access
                .item
                .metadata
                .referenced_citations
                .contains(name)
            {
                // The only error that is logged exists when there are
                // no receivers, which is not a problem.
                let _ = self.item_update_sender.send(
                    ItemChange::Update(item_access.key().clone()),
                );
            }
        });

        let _ = self
            .item_update_sender
            .send(ItemChange::Remove(name.into()));
    }

    /// Retrieve the base path of the HTML export of an item.
    pub async fn retrieve_pdf_path(
        self: &Arc<Self>,
        name: &str,
        group: &str,
    ) -> Option<PathBuf> {
        if let Some(item) = self.retrieve(name, group).await {
            if let Some(pdf_path) = item.pdf.preferred_path() {
                // Check that the pdf path is inside the base path.
                if !self.allow_outside_assets
                    && !pdf_path.starts_with(&*self.base_path)
                {
                    error!(
                        "PDF path {} is not inside the base path {}",
                        pdf_path.display(),
                        self.base_path.display()
                    );
                    return None;
                }
                return Some(pdf_path);
            }
            None
        } else {
            None
        }
    }

    /// Retrieve the base path of the HTML export of an item.
    pub async fn retrieve_html_base_path(
        self: &Arc<Self>,
        name: &str,
        group: &str,
    ) -> Option<PathBuf> {
        if let Some(item) = self.retrieve(name, group).await {
            if let Some(html_path) = item.html.preferred_path() {
                // Check that the pdf path is inside the base path.
                if !self.allow_outside_assets
                    && !html_path.starts_with(&*self.base_path)
                {
                    error!(
                        "HTML path {} is not inside the base path {}",
                        html_path.display(),
                        self.base_path.display()
                    );
                    return None;
                }
                return Some(html_path);
            }
            None
        } else {
            None
        }
    }
}
