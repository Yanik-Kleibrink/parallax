//! This file contains the regexes used for parsing items.

use regex::Regex;
use std::sync::LazyLock;

pub static FIND_TOP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^#\+(?<top_type>knowledge|view|project|research|teaching|report|activity|talk|reference):[^\S\r\n]*(?<subtype>\S*)").unwrap()
});
pub static FIND_ARTICLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\s*\*\s*(?<level>NEW|SECOND|SKIMMED|READ)(?<rest>.*)",
    )
    .unwrap()
});
pub static FIND_DESIRE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\:(?<desire>desire_new|desire_one|desire_two|desire_three)\:").unwrap()
});

pub static FIND_TITLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^#\+title:(?<title>.*)").unwrap()
});

pub static FIND_CITATIONS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[cite:(?<keys>(?:\s*@(?:\S*);?)*)(?:.*)\]").unwrap()
});
pub static FIND_ACCESS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^#\+access:(?<access>.*)").unwrap()
});
pub static FIND_VISIBLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^#\+visible").unwrap());
pub static FIND_INCLUDED_FILE: LazyLock<Regex> = LazyLock::new(
    || {
        Regex::new(r"(?m)^#\+(?:include:\s*(?:\S*/)*|add:\s*)(?<basename>[^.\s]+)(?:\.org)?").unwrap()
    },
);

pub static FIND_DUMP_BIBLIOGRAPHY: LazyLock<Regex> =
    LazyLock::new(|| {
        Regex::new(r"(?m)^#\+dump_bibliography:(?<path>.*)").unwrap()
    });
pub static FIND_DECLARE_MATH_OPERATORS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^#\+dmo:(?<dmo>.*)").unwrap());
pub static FIND_ASSETS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^#\+(?<type>pdf|video|html):(?<assets>.*)")
        .unwrap()
});

pub static FIND_KEYS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"@(?<key>[^\s;]+)").unwrap());
pub static FIND_BLOCK_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"#\+begin_(?<name>\S*)").unwrap());
pub static FIND_LATEX_AND_CITATIONS: LazyLock<Regex> = LazyLock::new(
    || {
        Regex::new(r"\\\((?<latex>.*?)\\\)|\\\[(?<display>[\s\S]*?)\\\]|(?<citation>\[cite:(?<keys>(?:\s*@(?:\S*);?)*)(?<additive>.*)\])")
        .unwrap()
    },
);
pub static FIND_TQF: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^#\+(?<severity>do|ques|fix):(?<content>.*)")
        .unwrap()
});
