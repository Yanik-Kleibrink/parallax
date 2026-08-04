//! Functions to set up a WASM runtime to run the TeX engine as well as compile TeX source to SVG.
use std::collections::HashMap;
use std::io::Read;
use std::io::Write;
use std::process::{Command, Stdio};
use tempfile::NamedTempFile;

use anyhow::Error;
use anyhow::Result;
use flate2::read::GzDecoder;
use tar::Archive;
//use wasmi::*;
use wasmtime::*;

//use dvi2html;

use crate::dvi2svg;
use crate::filesystem::*;
use crate::texjax_imports::*;

use std::collections::HashSet;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

const TEX_FILE_BYTES: &[u8] =
    include_bytes!("./assets/tex_files.tar.gz");
const WASM_BYTES: &[u8] = include_bytes!("./assets/tex.wasm");
const CORE_BYTES: &[u8] = include_bytes!("./assets/core.dump");

/// Holds the TeX engine and initialized `wasmr` runtime. This object stubs out all
/// of the system calls that the WASM-compiled TeX engine needs to run.
pub struct WasmRunner {
    //store: Store<VirtualFileSystem>,
    //instance: Instance,
    /// Whether the TeX engine has run or not.
    has_run: bool,
    filesystem: Option<VirtualFileSystem>,

    engine: Engine,
    module: Module,
}

impl WasmRunner {
    /// Create a new WasmRunner with pre-loaded TeX core.
    pub fn new() -> Result<Self> {
        // We have an in-memory file structure populated with the files that tex needs to run.
        // Extract these files to memory.
        let mut extracted_files =
            extract_tar_gz_to_memory(TEX_FILE_BYTES)?;
        // Add `input.tex` to the in-memory file structure.
        // This is the file that TeX will execute.
        //extracted_files.insert("input.tex".to_string(), b"\n\\begin{document}\n\\begin{tikzpicture}\n\\draw (0,0) circle (1in);\n\\end{tikzpicture}\n\\color{blue}$x^2$\n\nfoo\\par This is very cool!\\end{document}".to_vec());
        extracted_files.insert(
            "input.tex".to_string(),
            "\n\\begin{document}Hello World\\end{document}"
                .as_bytes()
                .to_vec(),
        );
        let mut filesystem = VirtualFileSystem::new(extracted_files);
        filesystem.set_stdin("input.tex \n\\end\n".as_bytes());

        // First step is to create the Wasm execution engine with some config.
        // In this example we are using the default configuration.
        let engine = Engine::default();
        let module = Module::new(&engine, WASM_BYTES)?;

        /*
        // All Wasm objects operate within the context of a `Store`.
        // Each `Store` has a type parameter to store host-specific data.
        type HostState = VirtualFileSystem;
        let mut store = Store::new(&engine, filesystem);
        // 1100 pages is taken from the tikzjax Javascript code.
        let memory = Memory::new(&mut store, MemoryType::new(1100, Some(1100))?)?;
        memory.write(&mut store, 0, CORE_BYTES)?;

        let imports = TexJaxImports::new(&mut store);

        // Create a linker and define all imports as coming from our rust library.
        let mut linker = <Linker<HostState>>::new(&engine);
        linker.define("library", "printInteger", imports.print_integer)?;
        linker.define("library", "printChar", imports.print_char)?;
        linker.define("library", "printString", imports.print_string)?;
        linker.define("library", "printNewline", imports.print_newline)?;
        linker.define("library", "reset", imports.reset)?;
        linker.define("library", "inputln", imports.input_ln)?;
        linker.define("library", "rewrite", imports.rewrite)?;
        linker.define("library", "get", imports.get)?;
        linker.define("library", "put", imports.put)?;
        linker.define("library", "eof", imports.eof)?;
        linker.define("library", "eoln", imports.eoln)?;
        linker.define("library", "erstat", imports.erstat)?;
        linker.define("library", "close", imports.close)?;
        linker.define("library", "getCurrentMinutes", imports.get_current_minutes)?;
        linker.define("library", "getCurrentDay", imports.get_current_day)?;
        linker.define("library", "getCurrentMonth", imports.get_current_month)?;
        linker.define("library", "getCurrentYear", imports.get_current_year)?;
        linker.define("library", "tex_final_end", imports.tex_final_end)?;
        linker.define("env", "memory", memory)?;

        // Execute the exported "main" function.
        let instance = linker.instantiate(&mut store, &module)?.start(&mut store)?;

        */
        Ok(Self {
            //   store,
            //   instance,
            filesystem: Some(filesystem),
            has_run: false,
            engine,
            module,
        })
    }

    /// Set the input contents that will be processed by TeX.
    pub fn set_input(&mut self, input: &[u8]) {
        if let Some(filesystem) = &mut self.filesystem {
            filesystem.set_file_contents(
                FileType::Named("input.tex"),
                input,
            );
            self.has_run = false;
        }
    }

    /// Run the TeX engine. If all is successful, a string with the output will be returned.
    pub fn run(&mut self) -> Result<String> {
        if true {
            self.has_run = true;

            /*
                        self.store
                            .data_mut()
                            .set_file_contents(FileType::Named("input.log"), b"");
                        self.store
                            .data_mut()
                            .set_file_contents(FileType::Named("input.aux"), b"");
                        self.store
                            .data_mut()
                            .set_file_contents(FileType::Named("input.dvi"), b"");
            */
            /*
            self.store
                .data_mut()
                .set_stdin(" input.tex \n\\end\n".as_bytes());
            */

            /*
            // We have an in-memory file structure populated with the files that tex needs to run.
            // Extract these files to memory.
            let mut extracted_files = self.extracted_files.clone();
            // Add `input.tex` to the in-memory file structure.
            // This is the file that TeX will execute.
            //extracted_files.insert("input.tex".to_string(), b"\n\\begin{document}\n\\begin{tikzpicture}\n\\draw (0,0) circle (1in);\n\\end{tikzpicture}\n\\color{blue}$x^2$\n\nfoo\\par This is very cool!\\end{document}".to_vec());
            extracted_files.insert(
                "input.tex".to_string(),
                "\n\\begin{document}Hello World\\end{document}"
                    .as_bytes()
                    .to_vec(),
            );
            let mut filesystem = VirtualFileSystem::new(extracted_files);
            filesystem.set_stdin(" input.tex \n\\end\n".as_bytes());

            */
            let mut filesystem = self.filesystem.take().ok_or(
                Error::msg("WasmRunner filesystem already taken."),
            )?;

            for filename in &filesystem.new_files {
                if filename == "input.tex" {
                    continue;
                }
                filesystem.data.remove(filename);
            }
            filesystem.new_files.clear();
            filesystem.fd_to_file_pointer.clear();
            filesystem.set_stdin(" input.tex \n\\end\n".as_bytes());
            if let Some(data) = filesystem
                .data
                .get_mut("tikzlibraryarrows.meta.code.tex")
            {
            }
            filesystem.data.remove("tikzlibraryarrows.meta.code.tex");

            let input_file = filesystem
                .get_file_contents(FileType::Named("input.tex"))
                .ok_or(Error::msg(
                    "Cannot find `input.tex`. Maybe compilation failed?",
                ))?;
            let input_tex_text = String::from_utf8_lossy(input_file);

            let keysA =
                filesystem.data.keys().collect::<HashSet<&String>>();

            let mut store = Store::new(&self.engine, filesystem);
            let memory = Memory::new(
                &mut store,
                MemoryType::new(1100, Some(1100)),
            )?;
            memory.write(&mut store, 0, CORE_BYTES)?;

            let imports = TexJaxImports::new(&mut store);

            // Create a linker and define all imports as coming from our rust library.
            type HostState = VirtualFileSystem;
            let mut linker = <Linker<HostState>>::new(&self.engine);
            linker.define(
                &mut store,
                "library",
                "printInteger",
                imports.print_integer,
            )?;
            linker.define(
                &mut store,
                "library",
                "printChar",
                imports.print_char,
            )?;
            linker.define(
                &mut store,
                "library",
                "printString",
                imports.print_string,
            )?;
            linker.define(
                &mut store,
                "library",
                "printNewline",
                imports.print_newline,
            )?;
            linker.define(
                &mut store,
                "library",
                "reset",
                imports.reset,
            )?;
            linker.define(
                &mut store,
                "library",
                "inputln",
                imports.input_ln,
            )?;
            linker.define(
                &mut store,
                "library",
                "rewrite",
                imports.rewrite,
            )?;
            linker.define(
                &mut store,
                "library",
                "get",
                imports.get,
            )?;
            linker.define(
                &mut store,
                "library",
                "put",
                imports.put,
            )?;
            linker.define(
                &mut store,
                "library",
                "eof",
                imports.eof,
            )?;
            linker.define(
                &mut store,
                "library",
                "eoln",
                imports.eoln,
            )?;
            linker.define(
                &mut store,
                "library",
                "erstat",
                imports.erstat,
            )?;
            linker.define(
                &mut store,
                "library",
                "close",
                imports.close,
            )?;
            linker.define(
                &mut store,
                "library",
                "getCurrentMinutes",
                imports.get_current_minutes,
            )?;
            linker.define(
                &mut store,
                "library",
                "getCurrentDay",
                imports.get_current_day,
            )?;
            linker.define(
                &mut store,
                "library",
                "getCurrentMonth",
                imports.get_current_month,
            )?;
            linker.define(
                &mut store,
                "library",
                "getCurrentYear",
                imports.get_current_year,
            )?;
            linker.define(
                &mut store,
                "library",
                "tex_final_end",
                imports.tex_final_end,
            )?;
            linker.define(&mut store, "env", "memory", memory)?;

            // Execute the exported "main" function.
            //let instance = linker.instantiate_and_start(&mut store, &self.module)?;
            let instance =
                linker.instantiate(&mut store, &self.module)?;
            //.ensure_no_start(&mut store)?;

            // Execute the exported "main" function.
            let main_func = instance
                .get_typed_func::<(), ()>(&mut store, "main")?;
            main_func.call(&mut store, ())?;

            // Retrieve the filesystem back from the store.
            filesystem = store.into_data();

            self.filesystem = Some(filesystem);
        }
        if let Some(fs) = &self.filesystem {
            // Get the raw DVI file
            let input_dvi =
                fs.get_file_contents(FileType::Named("input.dvi"))
                    .ok_or(Error::msg(
                        "Cannot find `input.dvi`. Maybe compilation failed?",
                    ))?;

            let mut hasher = DefaultHasher::new();
            input_dvi.hash(&mut hasher);

            let svg = dvi2svg(input_dvi).map_err(|e| {
                Error::msg(format!(
                    "Failed to convert DVI to HTML: {}",
                    e.to_string()
                ))
            })?;
            /*
            let svg = dvi2html::dvi2html(input_dvi).map_err(|e| {
                Error::msg(format!("Failed to convert DVI to HTML: {}", e.to_string()))
            })?;

            let svg = dvi_to_svg(input_dvi).map_err(|e| {
                Error::msg(format!("Failed to convert DVI to SVG: {}", e.to_string()))
            })?;

            let svg = fix_dvi(input_dvi);
            */

            return Ok(svg);
        }
        Err(Error::msg("WasmRunner filesystem is missing."))
    }

    /// Get the output that TeX wrote to stdout.
    pub fn get_messages(&self) -> Result<String> {
        if !self.has_run {
            return Err(Error::msg("TeX has not run yet."));
        }
        if let Some(fs) = &self.filesystem {
            let stdout = fs.get_stdout();
            return Ok(stdout);
        }
        Err(Error::msg("WasmRunner filesystem is missing."))
    }

    /// Get the log file that TeX wrote.
    pub fn get_log(&self) -> Result<String> {
        if !self.has_run {
            return Err(Error::msg("TeX has not run yet."));
        }
        if let Some(fs) = &self.filesystem {
            let input_log =
                fs.get_file_contents(FileType::Named("input.log"))
                    .ok_or(Error::msg(
                        "Cannot find `input.log`. Maybe compilation failed?",
                    ))?;
            let input_log_text = String::from_utf8_lossy(input_log);
            return Ok(input_log_text.to_string());
        }
        Err(Error::msg("WasmRunner filesystem is missing."))
    }
}

fn extract_tar_gz_to_memory(
    bytes: &[u8],
) -> Result<HashMap<String, Vec<u8>>> {
    // Create a GzDecoder to decompress the .tar.gz file
    let gz_decoder = GzDecoder::new(bytes);

    // Create a tar archive from the decompressed data
    let mut archive = Archive::new(gz_decoder);

    // Extract the tar archive to memory
    let mut extracted_files = HashMap::new();
    for entry in archive.entries()? {
        let mut entry = entry?;
        let mut file_data = Vec::new();
        entry.read_to_end(&mut file_data)?;
        let file_name = entry.path()?.to_string_lossy().into_owned();
        // Trim off a leading "./"
        let file_name = file_name.trim_start_matches("./");
        if file_name.is_empty() {
            continue;
        }
        extracted_files.insert(file_name.to_string(), file_data);
    }

    Ok(extracted_files)
}

/// Convert a TeX string to SVG using the given [`WasmRunner`]. This function can be called
/// multiple times with the same [`WasmRunner`].
pub fn tex2svg(
    wasm_runner: &mut WasmRunner,
    input_str: &str,
) -> Result<String> {
    wasm_runner.set_input(input_str.as_bytes());
    let svg = wasm_runner.run()?;
    Ok(svg)
}

fn dvi_to_svg(dvi_data: &Vec<u8>) -> Result<String> {
    let mut dvi_data = dvi_data.clone();
    fix_dvi(dvi_data.as_mut());
    fix_dvi_for_dvisvgm(&mut dvi_data);

    let mut child = Command::new("dvisvgm")
        .arg("--stdin") // read from stdin
        //.arg("-o")
        .arg("--stdout") // write SVG to stdout
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;

    // Write the DVI bytes into stdin
    child.stdin.as_mut().unwrap().write_all(&dvi_data)?;

    // Capture the output
    let output = child.wait_with_output()?;

    if !output.status.success() {
        return Err(Error::msg(format!(
            "dvisvgm failed {}",
            String::from_utf8_lossy(&output.stdout),
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

use dvi::Instruction;

pub fn fix_dvi_for_dvisvgm(dvi_data: &mut Vec<u8>) {
    let mut ranges_to_nop: Vec<(usize, usize)> = Vec::new();
    let mut offset = 0;

    // Pass 1: Identify problematic instructions (Immutable borrow)
    {
        let mut current_slice = &dvi_data[..];

        while !current_slice.is_empty() {
            let start_len = current_slice.len();

            // We use the 'dvi' crate's parser to find instruction boundaries
            match Instruction::parse(current_slice) {
                Ok((remaining, instruction)) => {
                    let instr_len = start_len - remaining.len();

                    // Check if the instruction is a special containing the invalid XML
                    let is_problematic = match instruction {
                        Instruction::Xxx(ref data) => {
                            if let Ok(s) = std::str::from_utf8(data) {
                                s.contains("<svg beginpicture>")
                                    || s.contains("</svg endpicture>")
                            } else {
                                false
                            }
                        }
                        _ => false,
                    };

                    if is_problematic {
                        ranges_to_nop.push((offset, instr_len));
                    }

                    // Advance pointers
                    offset += instr_len;
                    current_slice = remaining;
                }
                Err(_) => break, // Stop on parsing error
            }
        }
    } // The immutable borrow of `dvi_data` ends here

    // Pass 2: Apply fixes (Mutable borrow)
    for (start, len) in ranges_to_nop {
        for i in 0..len {
            dvi_data[start + i] = 138; // 138 is the DVI opcode for NOP
        }
    }
}

pub fn fix_dvi(dvi_data: &Vec<u8>) -> String {
    let mut ranges_to_nop: Vec<(usize, usize)> = Vec::new();
    let mut offset = 0;

    let mut current_slice = &dvi_data[..];

    let mut svg = String::new();

    svg.push_str(
        r#"<svg xmlns="http://www.w3.org/2000/svg" version="1.1">"#,
    );

    while !current_slice.is_empty() {
        let start_len = current_slice.len();

        // We use the 'dvi' crate's parser to find instruction boundaries
        match Instruction::parse(current_slice) {
            Ok((remaining, instr)) => {
                match instr {
                    Instruction::Xxx(data) => {
                        match std::str::from_utf8(&data) {
                            Ok(s) => {
                                if s.starts_with("dvisvgm:raw ") {
                                    let left = 0;
                                    let top = 0;

                                    let mut text = s
                                        .strip_prefix("dvisvgm:raw ")
                                        .unwrap()
                                        .to_owned();
                                    text = text.replace(
                                        r#"{?x}"#,
                                        &format!("{}", left),
                                    );
                                    text = text.replace(
                                        r#"{?y}"#,
                                        &format!("{}", top),
                                    );
                                    text = text
                                        .replace(r#"{?nl}"#, "\n");
                                    // Tikz will leave <svg beginpicture> and </svg endpicture> tags in the svg.
                                    // Since we wrap the entire document in an svg tag, we don't need them.
                                    text = text.replace(
                                        r#"<svg beginpicture>"#,
                                        "",
                                    );
                                    text = text.replace(
                                        r#"</svg endpicture>"#,
                                        "",
                                    );

                                    svg.push_str(&text);
                                }
                            }
                            Err(_) => (),
                        };
                    }
                    _ => (),
                }

                // Advance pointers
                current_slice = remaining;
            }
            _ => break, // Stop on parsing error
        }
    }
    svg.push_str("</svg>");

    return svg;
    // new_instrs now contains the modified instruction stream
}
