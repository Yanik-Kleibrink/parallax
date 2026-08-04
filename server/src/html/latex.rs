use katex::{Opts, OptsBuilder, render_with_opts};
use std::error::Error;
use std::fmt::Debug;
use std::sync::Arc;

use derivative::Derivative;

pub trait HTMLLatexExport: Debug {
    /// Convert string to latex
    fn export(&self, input: &str) -> Result<String, Box<dyn Error>>;

    /// Convert string to latex for display mode
    fn export_display(
        &self,
        input: &str,
    ) -> Result<String, Box<dyn Error>>;

    /// Add Declare Math Operators
    fn add_dmos(
        &self,
        dmos: &mut dyn Iterator<Item = String>,
    ) -> Result<Arc<dyn HTMLLatexExport + Send + Sync>, Box<dyn Error>>;
}

/// This structure encodes all data necessary for using the katex
/// (server-side) exporter.
#[derive(Derivative)]
#[derivative(Debug)]
pub struct KatexHTMLExport {
    /// This is the builder from which to derive the built options or
    /// to create new options with added DMOs.
    #[derivative(Debug = "ignore")]
    options_builder: OptsBuilder,
    options: Opts,
    options_display: Opts,
}

impl KatexHTMLExport {
    /// Create a new KatexHTMLExport with the given options builder.
    ///
    /// The options builder should not be configured with display
    /// mode. This is handled automatically.
    pub fn create(
        options_builder: OptsBuilder,
    ) -> Result<Self, Box<dyn Error>> {
        let options = options_builder.clone().build()?;
        let options_display =
            options_builder.clone().display_mode(true).build()?;
        Ok(KatexHTMLExport {
            options_builder: options_builder,
            options: options,
            options_display: options_display,
        })
    }
}

impl HTMLLatexExport for KatexHTMLExport {
    // TODO: Allow for the inclusion of Declare Math Operators into an
    // option here to allow for local DMOs.
    fn export(&self, input: &str) -> Result<String, Box<dyn Error>> {
        Ok(render_with_opts(input, &self.options)?)
    }

    fn export_display(
        &self,
        input: &str,
    ) -> Result<String, Box<dyn Error>> {
        Ok(render_with_opts(input, &self.options_display)?)
    }

    fn add_dmos(
        &self,
        dmos: &mut dyn Iterator<Item = String>,
    ) -> Result<Arc<dyn HTMLLatexExport + Send + Sync>, Box<dyn Error>>
    {
        let mut new_builder = self.options_builder.clone();
        for dmo in dmos {
            let key = format!("\\{}", dmo);
            let value = format!("\\operatorname{{{}}}", dmo);
            new_builder = new_builder.add_macro(key, value);
        }

        Ok(Arc::new(KatexHTMLExport::create(new_builder)?))
    }
}

#[cfg(test)]
mod test {
    use super::*;

    use std::collections::HashMap;

    fn default_options() -> KatexHTMLExport {
        KatexHTMLExport::create(katex::Opts::builder()).unwrap()
    }

    fn additional_macro() -> KatexHTMLExport {
        let mut builder = katex::Opts::builder();
        builder.macros(HashMap::from([(
            "\\R".to_owned(),
            "\\mathbb{R}".to_owned(),
        )]));
        KatexHTMLExport::create(builder).unwrap()
    }

    // No tests as the html output is the responsibility of the katex
    // crate.
}
