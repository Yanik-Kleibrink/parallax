use rust_tikz::{WasmRunner, tex2svg};
use std::fmt::Debug;
use std::io::Error;
use std::sync::{Arc, RwLock};

use derivative::Derivative;

use tracing::{debug, error, info};

pub trait HTMLTikzExport: Debug {
    /// Convert string to TikZ
    fn render(
        &self,
        input: &str,
    ) -> Result<String, Box<dyn std::error::Error>>;

    /// Add Declare Math Operators
    fn add_dmos(
        &self,
        dmos: &mut dyn Iterator<Item = String>,
    ) -> Result<
        Arc<dyn HTMLTikzExport + Send + Sync>,
        Box<dyn std::error::Error>,
    >;
}

#[derive(Clone, Derivative)]
#[derivative(Debug)]
pub struct TikzEngine {
    #[derivative(Debug = "ignore")]
    runner: Arc<RwLock<WasmRunner>>,
    cache: Arc<dashmap::DashMap<String, String>>,
}

impl TikzEngine {
    pub fn create() -> Result<Self, Box<dyn std::error::Error>> {
        let runner = WasmRunner::new()?;
        Ok(TikzEngine {
            runner: Arc::new(RwLock::new(runner)),
            cache: dashmap::DashMap::new().into(),
        })
    }

    pub fn render(
        &self,
        input: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        if let Some(cached) = self.cache.get(input) {
            return Ok(cached.value().clone());
        }
        debug!(input, "Rendering TikZ input");
        let mut runner = self.runner.write().unwrap();
        match tex2svg(&mut *runner, input) {
            Ok(svg) => {
                debug!(svg, "Rendered SVG output");
                let log_result = runner.get_messages()?;
                info!(log_result, "input.log");
                let log_file = runner.get_log()?;
                info!(log_file, "input.log file contents");
                self.cache.insert(input.to_owned(), svg.clone());
                Ok(svg)
            }
            Err(error) => {
                error!(%error);
                // Show the log file
                let log_result = runner.get_messages()?;
                error!(log_result, "input.log");
                Err(Box::new(Error::new(
                    std::io::ErrorKind::Other,
                    format!(
                        "Failed to render TikZ input with {}",
                        log_result
                    ),
                )))
            }
        }
        //let svg_output = text2svg_simple(input)?;
    }
}

#[derive(Debug, Clone)]
pub struct TikzHTMLExport {
    runner: TikzEngine,
    preamble: String,
}

impl TikzHTMLExport {
    pub fn create(runner: TikzEngine, preamble: &str) -> Self {
        TikzHTMLExport {
            runner,
            preamble: preamble.to_owned(),
        }
    }
}

impl HTMLTikzExport for TikzHTMLExport {
    fn add_dmos(
        &self,
        dmos: &mut dyn Iterator<Item = String>,
    ) -> Result<
        Arc<dyn HTMLTikzExport + Send + Sync>,
        Box<dyn std::error::Error>,
    > {
        let mut new_preamble = self.preamble.clone();
        for dmo in dmos {
            //let declare_cmd = format!("\\def\\{}{{{}}}", dmo, dmo);
            let declare_cmd =
                format!("\\DeclareMathOperator\\{}{{{}}}", dmo, dmo);
            new_preamble.push_str(&declare_cmd);
        }

        Ok(Arc::new(TikzHTMLExport::create(
            self.runner.clone(),
            &new_preamble,
        )))
    }

    fn render(
        &self,
        input: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let mut full_document = String::new();
        //full_document.push_str(r"\usepackage{tracefnt}");
        full_document.push_str(r"\usepackage{amssymb}");
        full_document.push_str(r"\usepackage{amsmath}");
        //full_document.push_str(r"\usepackage{exscale} ");
        full_document.push_str(r"\usetikzlibrary{cd}");
        full_document.push_str(&self.preamble);
        full_document.push_str(r"\begin{document}");
        full_document.push_str(input);
        full_document.push_str(r"\end{document}");
        self.runner.render(full_document.as_str())
    }
}
