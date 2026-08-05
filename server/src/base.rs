use crate::html::latex::KatexHTMLExport;
use crate::html::tikz::{TikzEngine, TikzHTMLExport};
use crate::items_management::ItemDatabase;
use crate::parsing::deep_parser::HTMLExportConfiguration;
use crate::routes::assets::{access_asset, grant_asset};
use crate::routes::auth::{JWTRequest, access, grant_access};
use crate::routes::websocket::new_websocket;

use actix_cors::Cors;
use actix_web::middleware::Logger;
use actix_web::web::Data;
use actix_web::{App, HttpServer, http::header, web};
use biblatex::Bibliography;
use futures_util::future::join_all;
use notify::RecommendedWatcher;
use notify::RecursiveMode;
use notify_debouncer_full::new_debouncer;
use notify_debouncer_full::{DebounceEventResult, RecommendedCache};
use rustls::{
    ServerConfig,
    pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject},
};
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::runtime::Handle;
use tracing::{debug, error, info, warn};
use walkdir::WalkDir;
use xxhash_rust::xxh3::xxh3_64;

use std::collections::BTreeMap;

use moka::future::Cache;

#[derive(Deserialize, Serialize)]
struct PublicConfig {
    port: u16,
    jwt_secret: String,
    tls_certificate_path: PathBuf,
    tls_key_path: PathBuf,
}

#[derive(Deserialize, Serialize)]
struct WheelConfig {
    port: u16,
}

#[derive(Deserialize, Serialize)]
struct APIServerConfig {
    wheel: Option<WheelConfig>,

    public: Option<PublicConfig>,

    /// This is a list of admissible URLs from which the client stems
    /// from. It is necessary as otherwise CORS will block the
    /// requests from the client to the server.
    client_urls: Vec<String>,

    /// This flag indicates whether tokens are also passed directly
    /// to the client and not only stored in a secure http-only
    /// cookie.
    ///
    /// Due to tracking preventions secure http-only cookies do not
    /// work on Webkit. This flag allows to disable the secure
    /// http-only cookie and pass the token directly to the
    /// client. This is insecure and should only be used for
    /// testing purposes.
    insecure_tokens: Option<bool>,
}

#[derive(Deserialize, Serialize)]
struct ItemsFileWatcherConfig {
    // Empty because there are no options.
}

#[derive(Deserialize, Serialize)]
struct BibLatexSourceConfig {
    // Empty because there are no options.
}

#[derive(Deserialize, Serialize)]
enum BibliographySource {
    BibLatex(BibLatexSourceConfig),
}

#[derive(Deserialize, Serialize)]
struct KatexSourceConfig {
    /// Should the macros \aK, \bR, etc. be defined
    /// Not specified defaults to true
    default_math_font_abbreviations: Option<bool>,
    /// Additional macros to define in katex syntax.
    ///
    /// Note that a BTreeMap is used to ensure that the macros are
    /// defined in a deterministic order, which is important for
    /// caching and hashing.
    macros: Option<BTreeMap<String, String>>,
    /// A list of strings. Each string defines a math operator to be
    /// declared.
    declare_math_operators: Option<Vec<String>>,
}

#[derive(Deserialize, Serialize)]
enum LatexSource {
    Katex(KatexSourceConfig),
    // MathJax(MathJaxSourceConfig),
}

#[derive(Deserialize, Serialize)]
struct BaseConfig {
    api_server: APIServerConfig,

    // If the file watcher isn't enabled it also isn't possible to
    // update the config while the server is running.
    items_file_watcher: Option<ItemsFileWatcherConfig>,
    //  items_udp_watcher: Option<ItemsUDPWatcherConfig>,
    bibliography_source: BibliographySource,

    /// Create and update a bibliography.bib file as specified in the
    /// file location.
    dump_bibliography: Option<PathBuf>,
    latex_source: LatexSource,
}

impl BaseConfig {
    fn hash(&self) -> u64 {
        xxh3_64(
            serde_yaml::to_string(self)
                .expect("Failed to serialize BaseConfig")
                .as_bytes(),
        )
    }

    fn generate_initial_html_export(
        &self,
    ) -> Result<HTMLExportConfiguration, Box<dyn Error>> {
        info!("Generating HTML export configuration...");

        let bib_source = match &self.bibliography_source {
            BibliographySource::BibLatex(_config) => {
                let bibliography = Bibliography::new();
                // The bibliography files are added during the initial
                // walk.
                bibliography
            }
        };

        let latex_source = match &self.latex_source {
            LatexSource::Katex(config) => {
                let mut options = katex::Opts::builder();
                options.throw_on_error(false);

                // Now, add the abbreviations for the common math
                // fonts.
                if config
                    .default_math_font_abbreviations
                    .unwrap_or(true)
                {
                    for (i, ch) in
                        ('A'..='Z').chain('a'..='z').enumerate()
                    {
                        if i < 26 {
                            for (short, variant) in &[
                                ('r', "rm"),
                                ('i', "it"),
                                ('c', "cal"),
                                ('s', "scr"),
                                ('b', "bb"),
                                ('a', "sf"),
                            ] {
                                let key =
                                    format!("\\{}{}", short, ch);
                                let value = format!(
                                    "\\math{}{{{}}}",
                                    variant, ch
                                );
                                options =
                                    options.add_macro(key, value);
                            }
                        }
                        if i != 34 {
                            // unequal to i
                            let key = format!("\\f{}", ch);
                            let value = format!("\\mathbf{{{}}}", ch);
                            options = options.add_macro(key, value);
                        }
                        let key = format!("\\k{}", ch);
                        let value = format!("\\mathfrak{{{}}}", ch);
                        options = options.add_macro(key, value);
                    }
                }

                for (k, v) in config.macros.iter().flatten() {
                    options = options.add_macro(k.clone(), v.clone());
                }

                if let Some(dmos) = &config.declare_math_operators {
                    for dmo in dmos {
                        let key = format!("\\{}", dmo);
                        let value =
                            format!("\\operatorname{{{}}}", dmo);
                        options = options.add_macro(key, value);
                    }
                }

                KatexHTMLExport::create(options)?
            }
        };

        let mut preamble = String::new();

        // Now, add the abbreviations for the common math fonts.
        if true {
            for (i, ch) in ('A'..='Z').chain('a'..='z').enumerate() {
                if i < 26 {
                    for (short, variant) in &[
                        ('r', "rm"),
                        ('i', "it"),
                        ('c', "cal"),
                        ('s', "scr"),
                        ('b', "bb"),
                        ('a', "sf"),
                    ] {
                        preamble.push_str(&format!(
                            "\\def\\{}{}{{\\math{}{{{}}}}}\n",
                            short, ch, variant, ch
                        ));
                    }
                }
                if i != 34 {
                    // unequal to i
                    preamble.push_str(&format!(
                        "\\def\\f{}{{\\mathbf{{{}}}}}\n",
                        ch, ch
                    ));
                }
                preamble.push_str(&format!(
                    "\\def\\k{}{{\\mathfrak{{{}}}}}\n",
                    ch, ch
                ));
            }
        }

        Ok(HTMLExportConfiguration {
            bibliography: Arc::new(bib_source),
            latex: Arc::new(latex_source),
            tikz: Arc::new(TikzHTMLExport::create(
                TikzEngine::create()?,
                preamble.as_str(),
            )),
        })
    }
}

pub struct Base {
    root_path: PathBuf,

    config: Arc<BaseConfig>,

    items: Arc<ItemDatabase>,

    // These handles are only necessary when allowing for the
    // configuration to change without a full server restart.
    // api_server_handle: Option<actix_web::ServerHandle>,
    file_watcher: Option<
        notify_debouncer_full::Debouncer<
            RecommendedWatcher,
            RecommendedCache,
        >,
    >,
}

// TODO: Config changes are currently not supported!
impl Base {
    pub fn build(
        root_path: &PathBuf,
    ) -> Result<Base, Box<dyn Error>> {
        let config_file =
            fs::read_to_string(root_path.join("config.yaml"))?;
        let config: BaseConfig = serde_yaml::from_str(&config_file)?;

        let html_export = config.generate_initial_html_export()?;
        Ok(Base {
            root_path: root_path.into(),
            config: config.into(),

            file_watcher: None,
            items: Arc::new(ItemDatabase::new(
                &root_path,
                html_export.clone(),
            )),
        })
    }

    pub async fn go(&mut self) -> Result<(), Box<dyn Error>> {
        if let Some(dump_path) = &self.config.dump_bibliography {
            self.items.clone().start_global_bibliography_dump(
                &self.root_path.join(dump_path),
            )?;
        }

        self.initialize_items_db().await;

        let mut tasks = Vec::new();
        if let Some(_file_watcher_config) =
            &self.config.items_file_watcher
        {
            self.start_file_watcher()?;
        } else {
            info!("File watcher for items is not enabled.");
        }

        tasks.push(self.start_api_server());

        join_all(tasks).await;

        Ok(())
    }

    async fn start_api_server(&self) -> Result<(), Box<dyn Error>> {
        let items = Arc::clone(&self.items);
        let client_urls = self.config.api_server.client_urls.clone();
        let secret = match &self.config.api_server.public {
            Some(config) => config.jwt_secret.clone(),
            None => String::new(),
        };
        let token_cache: web::Data<Cache<String, JWTRequest>> =
            web::Data::new(
                Cache::builder()
                    .time_to_live(Duration::from_secs(10 * 60))
                    .build(),
            );
        let config_hash = self.config.hash();
        let insecure_tokens =
            self.config.api_server.insecure_tokens.unwrap_or(false);

        // Create the server
        let mut server = HttpServer::new(move || {
            let client_urls = client_urls.clone();
            let secret = secret.clone();
            let token_cache = token_cache.clone();
            let config_hash = config_hash.clone();
            let insecure_tokens = insecure_tokens.clone();

            App::new()
                .wrap(
                    Cors::default()
                        .allowed_origin_fn(move |origin, _| {
                            client_urls.iter().any(|allowed| {
                                origin.as_bytes()
                                    == allowed.as_bytes()
                            })
                        })
                        .allowed_methods(vec![
                            "GET", "POST", "OPTIONS",
                        ])
                        .allowed_headers(vec![
                            header::CONTENT_TYPE,
                            header::AUTHORIZATION,
                            header::RANGE,
                        ])
                        .expose_headers(vec![
                            header::CONTENT_TYPE,
                            header::AUTHORIZATION,
                            header::RANGE,
                            header::CONTENT_RANGE,
                            header::ACCEPT_RANGES,
                            header::CONTENT_LENGTH,
                        ])
                        .supports_credentials(),
                )
                .app_data(Data::from(Arc::clone(&items)))
                .app_data(Data::new(secret))
                .app_data(token_cache.clone())
                .app_data(Data::new(config_hash))
                .app_data(Data::new(insecure_tokens))
                .wrap(Logger::default())
                .route("/ws", web::get().to(new_websocket))
                .service(access_asset)
                .service(grant_asset)
                .service(grant_access)
                .service(access)
        });

        // Bind to configured ports
        if let Some(wheel_config) = &self.config.api_server.wheel {
            server = server.bind(("127.0.0.1", wheel_config.port))?;
        }
        if let Some(public_config) = &self.config.api_server.public {
            let path_cert = self
                .root_path
                .join(&public_config.tls_certificate_path);
            let path_key =
                self.root_path.join(&public_config.tls_key_path);

            debug!(path = ?path_cert, "Checking for TLS certificate");
            debug!(key = ?path_key, "Checking for TLS key");

            if path_cert.exists() && path_key.exists() {
                info!(
                    "TLS certificate and key found. Starting server with TLS."
                );

                // load TLS key/cert files
                let cert_chain =
                    CertificateDer::pem_file_iter(path_cert)?
                        .flatten()
                        .collect();

                let key_der = PrivateKeyDer::from_pem_file(path_key)?;

                let tls_config = ServerConfig::builder()
                    .with_no_client_auth()
                    .with_single_cert(cert_chain, key_der)?;
                server = server.bind_rustls_0_23(
                    ("0.0.0.0", public_config.port),
                    tls_config,
                )?;
                info!(public_config.port, "Server started with TLS");
            } else {
                warn!(
                    "TLS certificate or key not found. Starting server without TLS."
                );
                // Listen on all addresses with 0.0.0.0 and not only
                // the loopback device.
                server =
                    server.bind(("0.0.0.0", public_config.port))?;
            }
        }

        // Run the server
        server.run().await.map_err(Into::into)
    }

    fn start_file_watcher(&mut self) -> Result<(), Box<dyn Error>> {
        let items = self.items.clone();

        info!("Starting file watcher...");

        let rt = Handle::current();
        let mut debouncer = new_debouncer(
                Duration::from_millis(200),
                None,
                move |result: DebounceEventResult| {
                    let items = items.clone();
                    rt.spawn(async move {
                        match result {
                            Ok(events) =>
                                for event in events {
                                    if event.event.kind.is_modify() || event.event.kind.is_create() || event.event.kind.is_remove() {
                                        for path in event.event.paths {
                                            // Don't canonicalize the path here, as it may not exist anymore (in case of a remove event).
                                           handle_file_update(items.clone(), &path, if event.event.kind.is_remove() { ItemUpdateEvent::Remove } else { ItemUpdateEvent::Update });
                                        }
                                    }
                                }
                            Err(errs) => {
                                for err in errs {
                                    error!(error=%err, "file watch error");
                                }
                            }
                        }
                    });
                },
            ).unwrap();

        let canonical_root = match self.root_path.canonicalize() {
            Ok(p) => p,
            Err(err) => {
                error!(
                    path = ?self.root_path,
                    error = %err, "Failed to canonicalize root path",
                );
                panic!();
            }
        };

        // ignore failures
        debouncer.watch(canonical_root, RecursiveMode::Recursive)?;
        //    .ok();
        // The directories are manually walked to ensure that the
        // watcher passes over files that do not have the correct
        // permissions
        /*
        for entry in WalkDir::new(&self.root_path)
                .into_iter()
                .filter_entry(|entry| {
                    // Always allow files to be yielded
                    if !entry.file_type().is_dir() {
                        return true;
                    }

                    // Check if file starts with a dot and ignore it if so
                    if entry
                        .path()
                        .file_name()
                        .and_then(OsStr::to_str)
                        .map(|name| name.starts_with('.'))
                        .unwrap_or(false)
                    {
                        info!(
                            path = ?entry.path(),
                            "Skipping directory (hidden)"
                        );
                        return false;
                    }

                    let parent = match entry.path().parent() {
                        Some(p) => p,
                        None => return false,
                    };

                    // The parent is checked for notes_server_ignore so that the server can detect updates to the presence of notes_server_ignore files
                    let parent = match parent.canonicalize() {
                        Ok(p) => p,
                        Err(_) => return false,
                    };

                    // Ensure the directory is inside the root path.
                    // If it is not do not consider .notes_server_ignore
                    if !parent.starts_with(&canonical_root) {return true};

                    // Check for `.notes_server_ignore` in the parent directory
                    let terminate = parent.join(".notes_server_ignore");
                    if terminate.exists() {
                        info!(
                            path = ?entry.path(),
                            "Skipping directory (found .notes_server_ignore)",
                        );
                    }
                    !terminate.exists()
                })
                .filter_map(Result::ok)
                .filter(|e| e.file_type().is_dir())
            {
                // Skip unreadable dirs
                if std::fs::read_dir(entry.path()).is_err() {
                    continue;
                }

                debug!(path = ?entry.path(), "Watching directory.");
                debouncer
                    .watch(entry.path(), RecursiveMode::NonRecursive)
                    .ok(); // ignore failures
            }
        */
        self.file_watcher = Some(debouncer);

        Ok(())
    }

    async fn initialize_items_db(&mut self) {
        // Walk org files
        for entry in WalkDir::new(self.root_path.clone())
            .into_iter()
            .filter_map(|e| e.ok()) // ignore unreadable files
            .filter(|entry| entry.file_type().is_file())
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .map(|ext| {
                        ext == "org" || ext == "bib" || ext == "pdf"
                    })
                    .unwrap_or(false)
            })
        {
            let item_path = entry.path();
            handle_file_update(
                Arc::clone(&self.items),
                &item_path.to_path_buf(),
                ItemUpdateEvent::Update,
            );
        }
    }
}

fn get_name_content(path: &Path) -> Option<(String, String)> {
    if let Some(item_raw_name) = path.file_stem() {
        if let Some(item_raw_name_str) = item_raw_name.to_str() {
            let mut item_raw_name_str =
                String::from(item_raw_name_str);
            // For base.org and tasks.org prepend the next higher
            // directory name to make the name unique:
            if matches!(item_raw_name_str.as_str(), "base" | "tasks")
            {
                warn!(
                    path = ?path,
                    "This behavior is deprecated and will be removed in a future version. Please rename the file to something else to avoid name collisions."
                );
                if let Some(parent_name) =
                    path.parent().map(|p| p.file_stem()).flatten()
                {
                    if let Some(parent_name) = parent_name.to_str() {
                        item_raw_name_str = String::from(parent_name)
                            + "_"
                            + &item_raw_name_str;
                    } else {
                        warn!(
                            path = ?path,
                            "Couldn't extract parent. This is very likely to lead to the overwritting of other base.org or tasks.org files!"
                        );
                    }
                } else {
                    warn!(
                        path = ?path,
                        "Couldn't extract parent. This is very likely to lead to the overwritting of other base.org or tasks.org files!"
                    );
                }
            }

            // Try to read the file
            match fs::read_to_string(path) {
                Err(err) => {
                    error!(
                        path = ?path,
                        error = %err, "Reading item (org) file failed"
                    );
                    None
                }
                Ok(src) => Some((item_raw_name_str, src)),
            }
        } else {
            error!(
                ?item_raw_name,
                "Could not extract string from file stem"
            );
            None
        }
    } else {
        error!(path = ?path, "Could not extract file stem");
        None
    }
}

/// An event that indicates whether an item was updated or removed.
enum ItemUpdateEvent {
    Update,
    Remove,
}

/// Handle a file update event. This function is called when a file is
/// modified, created, or removed.
fn handle_file_update(
    items: Arc<ItemDatabase>,
    path: &PathBuf,
    event: ItemUpdateEvent,
) {
    if path.exists() && path.is_file() {
        match path.extension().and_then(OsStr::to_str) {
            Some("org") => {
                debug!(
                    path=?path,
                    "Modified or created org file"
                );
                if let Some((name, content)) = get_name_content(&path)
                {
                    match event {
                        ItemUpdateEvent::Update => {
                            if let Err(err) =
                                items.add(&name, &path, &content)
                            {
                                error!(
                                    path=?path,
                                    name=?name,
                                    error=%err, "Adding item to database failed"
                                );
                            }
                        }
                        ItemUpdateEvent::Remove => {
                            let _ = items.remove(&name);
                        }
                    }
                }
            }
            Some("bib") => {
                let name = path
                    .file_stem()
                    .and_then(OsStr::to_str)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| String::from("unknown"));
                match event {
                    ItemUpdateEvent::Update => {
                        items.add_bib(&name, &path)
                    }
                    ItemUpdateEvent::Remove => {
                        items.drop_bib(&name);
                    }
                }
            }
            Some("pdf") => {
                let name = path
                    .file_stem()
                    .and_then(OsStr::to_str)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| String::from("unknown"));

                match event {
                    ItemUpdateEvent::Update => {
                        if path.exists() {
                            debug!(
                                path=?path,
                                "Modified or created pdf file"
                            );
                            items.register_pdf(&name, &path);
                        }
                    }
                    ItemUpdateEvent::Remove => {
                        debug!(
                            path=?path,
                            "Removed pdf file"
                        );
                        items.drop_pdf(&name, &path);
                    }
                }
                debug!(
                    path=?path,
                    "Detected modified or created pdf file"
                );
                items.register_pdf(&name, &path);
            }
            Some("ignore_parallax") => {
                error!(
                    "Updating the file watcher due to changes in .ignore_parallax is not yet supported!"
                );
            }
            Some(ext) => {
                info!(
                    path=?path,
                    extension=ext,
                    "Detected modified file with unsupported extension"
                );
            }
            None => {
                warn!(
                    path=?path,
                    "File extension could not be determined for modified file"
                );
            }
        }
    }
}
