/// Maps TeX font encodings to Unicode.
pub fn get_unicode(font_name: &str, code: u32) -> String {
    if font_name.starts_with("cmmi") {
        map_cmmi(code)
    } else if font_name.starts_with("cmsy") {
        map_cmsy(code)
    } else {
        // Default ASCII mapping for standard fonts (like cmr)
        // We must escape XML special characters
        match code {
            0x26 => "&amp;".to_string(), // &
            0x3C => "&lt;".to_string(),  // <
            0x3E => "&gt;".to_string(),  // >
            // Standard printable ASCII
            32..=126 => std::char::from_u32(code).unwrap().to_string(),
            // Fallback for others (e.g. accents)
            _ => format!("&#{};", code),
        }
    }
}

fn map_cmmi(code: u32) -> String {
    // TeX Math Italic (cmmi) to Unicode
    match code {
        0x00 => "Γ".to_string(), // Gamma
        0x01 => "Δ".to_string(), // Delta
        0x02 => "Θ".to_string(), // Theta
        0x03 => "Λ".to_string(), // Lambda
        0x04 => "Ξ".to_string(), // Xi
        0x05 => "Π".to_string(), // Pi
        0x06 => "Σ".to_string(), // Sigma
        0x07 => "Υ".to_string(), // Upsilon
        0x08 => "Φ".to_string(), // Phi
        0x09 => "Ψ".to_string(), // Psi
        0x0A => "Ω".to_string(), // Omega
        0x0B => "α".to_string(), // alpha
        0x0C => "β".to_string(), // beta
        0x0D => "γ".to_string(), // gamma
        0x0E => "δ".to_string(), // delta
        0x0F => "ϵ".to_string(), // epsilon (lunate)
        0x10 => "ζ".to_string(), // zeta
        0x11 => "η".to_string(), // eta
        0x12 => "θ".to_string(), // theta
        0x13 => "ι".to_string(), // iota
        0x14 => "κ".to_string(), // kappa
        0x15 => "λ".to_string(), // lambda
        0x16 => "μ".to_string(), // mu
        0x17 => "ν".to_string(), // nu
        0x18 => "ξ".to_string(), // xi
        0x19 => "π".to_string(), // pi
        0x1A => "ρ".to_string(), // rho
        0x1B => "σ".to_string(), // sigma
        0x1C => "τ".to_string(), // tau
        0x1D => "υ".to_string(), // upsilon
        0x1E => "ϕ".to_string(), // phi (variant)
        0x1F => "χ".to_string(), // chi
        0x20 => "ψ".to_string(), // psi
        0x21 => "ω".to_string(), // omega
        0x22 => "ε".to_string(), // epsilon
        0x23 => "ϑ".to_string(), // theta (variant)
        0x24 => "ϖ".to_string(), // pi (variant)
        0x25 => "ϱ".to_string(), // rho (variant)
        0x26 => "ς".to_string(), // sigma (final)
        0x27 => "φ".to_string(), // phi
        // Map a-z and A-Z to standard ASCII for now
        // (technically these should be math italic Unicode, but standard fonts handle italicizing)
        0x41..=0x5A | 0x61..=0x7A => std::char::from_u32(code).unwrap().to_string(),
        _ => format!("&#{};", code),
    }
}

fn map_cmsy(code: u32) -> String {
    // TeX Math Symbols (cmsy) to Unicode
    match code {
        0x00 => "−".to_string(), // minus (different from hyphen)
        0x01 => "⋅".to_string(), // cdot
        0x02 => "×".to_string(), // times
        0x03 => "∗".to_string(), // asterisk
        0x04 => "÷".to_string(), // div
        0x05 => "⋄".to_string(), // diamond
        0x06 => "±".to_string(), // pm
        0x07 => "∓".to_string(), // mp
        0x08 => "⊕".to_string(), // oplus
        0x09 => "⊖".to_string(), // ominus
        0x0A => "⊗".to_string(), // otimes
        0x0B => "⊘".to_string(), // oslash
        0x0C => "⊙".to_string(), // odot
        0x0D => "◯".to_string(), // bigcirc
        0x0E => "∘".to_string(), // circ
        0x0F => "∙".to_string(), // bullet
        0x10 => "≍".to_string(), // asymp
        0x11 => "≡".to_string(), // equiv
        0x12 => "⊆".to_string(), // subseteq
        0x13 => "⊇".to_string(), // supseteq
        0x14 => "≤".to_string(), // leq
        0x15 => "≥".to_string(), // geq
        0x16 => "≼".to_string(), // preceq
        0x17 => "≽".to_string(), // succeq
        0x18 => "∼".to_string(), // sim
        0x19 => "≈".to_string(), // approx
        0x1A => "⊂".to_string(), // subset
        0x1B => "⊃".to_string(), // supset
        0x1C => "≪".to_string(), // ll
        0x1D => "≫".to_string(), // gg
        0x1E => "≺".to_string(), // prec
        0x1F => "≻".to_string(), // succ
        0x20 => "←".to_string(), // leftarrow
        0x21 => "→".to_string(), // rightarrow
        0x22 => "↑".to_string(), // uparrow
        0x23 => "↓".to_string(), // downarrow
        0x24 => "↔".to_string(), // leftrightarrow
        0x25 => "↗".to_string(), // nearrow
        0x26 => "↘".to_string(), // searrow
        0x27 => "≃".to_string(), // simeq
        0x28 => "⇐".to_string(), // Leftarrow
        0x29 => "⇒".to_string(), // Rightarrow
        0x2A => "⇑".to_string(), // Uparrow
        0x2B => "⇓".to_string(), // Downarrow
        0x2C => "⇔".to_string(), // Leftrightarrow
        0x2D => "↖".to_string(), // nwarrow
        0x2E => "↙".to_string(), // swarrow
        0x2F => "∝".to_string(), // propto
        0x32 => "∈".to_string(), // in
        0x33 => "∋".to_string(), // ni
        0x38 => "¬".to_string(), // neg
        0x3A => "∀".to_string(), // forall
        0x3B => "∃".to_string(), // exists
        0x61 => "ℵ".to_string(), // aleph
        0x62 => "ℜ".to_string(), // Re
        0x63 => "ℑ".to_string(), // Im
        0x6A => "|".to_string(), // |
        0x6B => "∥".to_string(), // \|
        _ => format!("&#{};", code),
    }
}
