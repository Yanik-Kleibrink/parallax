use biblatex::{
    Bibliography, DateValue, Entry, EntryType::*, PermissiveType,
};
use serde::Serialize;
use std::fmt::Debug;
use std::sync::Arc;
use tracing::{instrument, warn};
use xxhash_rust::xxh3::xxh3_64;

#[derive(Serialize, Debug, PartialEq, strum::Display, Clone)]
pub enum CitationType {
    Paper,
    Talk,
    Patent,
    Discussion,
}

pub trait HTMLBibliographyEntry: Debug {
    //! This trait fixes the functions needed from individual
    //! bibliography items for the HTML export.

    /// Returns the title of the entry as a string.
    fn html_title(&self) -> String;

    /// Returns the year of the entry.
    fn html_year(&self) -> Option<i32>;

    /// Returns the month of the entry.
    fn html_month(&self) -> Option<u8>;

    /// Returns the day of the entry.
    fn html_day(&self) -> Option<u8>;

    /// Returns the location (book, journal, proceedings) of the
    /// entry.
    fn html_location(&self) -> String;

    /// Returns the names (first name + last name) of the authors of
    /// the entry.
    fn html_authors(&self) -> Vec<String>;

    /// Returns the abbreviation DIN 1505-2 of this entry, e.g., GW10,
    /// Wed02.
    fn html_citation(&self) -> String;

    /// Returns the type of the entry.
    fn html_type(&self) -> CitationType;

    /// Returns the key of the entry.
    fn key(&self) -> &str;

    /// Get the biblatex representation of the entry.
    fn dump(&self) -> String;

    /// Returns a hash of all the information of the entry.
    fn hash_all_information(&self) -> u64;

    /// Returns a hash of the abbreviation of the entry.
    fn hash_abbreviation(&self) -> u64;
}

impl HTMLBibliographyEntry for Entry {
    fn key(&self) -> &str {
        &self.key
    }

    #[instrument(skip(self), fields(self.key = %self.key))]
    fn html_type(&self) -> CitationType {
        match &self.entry_type {
            Unknown(val) if val == "talk" => CitationType::Talk,
            Unknown(val) if val == "discussion" => {
                CitationType::Discussion
            }
            Patent => CitationType::Patent,
            _ => CitationType::Paper,
        }
    }

    #[instrument(skip(self), fields(self.key = %self.key))]
    fn html_title(&self) -> String {
        let title = self
            .title()
            .inspect_err(|err| {
                warn!(error=%err, "Error retrieving the title ");
            })
            .ok()
            .map(|t| {
                t.iter().fold(String::new(), |acc, value| {
                    acc + value.v.get()
                })
            })
            .unwrap_or(String::new());
        if title.is_empty() {
            warn!("The entry has no title.");
        }
        title
    }

    #[instrument(skip(self), fields(self.key = %self.key))]
    fn html_year(&self) -> Option<i32> {
        self.date().ok().and_then(|result| match result {
            PermissiveType::Typed(date) => match date.value {
                DateValue::At(date_value) => Some(date_value.year),
                _ => None,
            },
            _ => None,
        })
    }

    #[instrument(skip(self), fields(self.key = %self.key))]
    fn html_month(&self) -> Option<u8> {
        self.date().ok().and_then(|result| match result {
            PermissiveType::Typed(date) => match date.value {
                DateValue::At(date_value) => date_value.month,
                _ => None,
            },
            _ => None,
        })
    }

    #[instrument(skip(self), fields(self.key = %self.key))]
    fn html_day(&self) -> Option<u8> {
        self.date().ok().and_then(|result| match result {
            PermissiveType::Typed(date) => match date.value {
                DateValue::At(date_value) => date_value.day,
                _ => None,
            },
            _ => None,
        })
    }

    #[instrument(skip(self), fields(self.key = %self.key))]
    fn html_location(&self) -> String {
        match &self.entry_type {
            InProceedings => self
                .book_title()
                .inspect_err(|err| {
                    warn!(error=%err, "Error retrieving the book title.");
                })
                .ok()
                .map(|t| {
                    t.iter().fold(String::new(), |acc, value| {
                        acc + value.v.get()
                    })
                })
                .unwrap_or(String::new()),
            Book => self
                .publisher()
                .inspect_err(|err| {
                    warn!(error=%err, "Error retrieving the publisher.");
                })
                .unwrap_or(vec![])
                .iter()
                .map(|t| {
                    t.iter().fold(String::new(), |acc, value| {
                        acc + value.v.get()
                    })
                })
                .fold(String::new(), |acc, value| acc + &value),
            Article => self
                .journal()
                .inspect_err(|err| {
                    warn!(error=%err, "Error retrieving the journal title.");
                })
                .ok()
                .map(|t| {
                    t.iter().fold(String::new(), |acc, value| {
                        acc + value.v.get()
                    })
                })
                .unwrap_or(String::new()),
            Unknown(val) => {
                self.location()
                    .inspect_err(|err| {
                        warn!(error=%err, "Error retrieving the location.");
                    })
                    .ok()
                    .map(|t| {
                        t.iter().fold(String::new(), |acc, value| {
                            acc + value.v.get()
                        })
                    })
                    .unwrap_or_else(|| {
                        warn!(%val, "Unknown entry type");
                        String::new()
                    })
            }
            entry_type => {
                warn!(%entry_type, "No location supported");
                String::new()
            }
        }
    }

    #[instrument(skip(self), fields(self.key = %self.key))]
    fn html_authors(&self) -> Vec<String> {
        self.author()
            .inspect(|a| {
                if a.len() == 0 {
                    warn!("No authors.");
                }
            })
            .unwrap_or_else(|err| {
                warn!(error = %err, "Error retrieving authors");
                vec![]
            })
            .into_iter()
            .map(|value| {
                (value.given_name
                    + " "
                    + &value.prefix
                    + " "
                    + &value.name
                    + " "
                    + &value.suffix)
                    .trim()
                    .to_string()
            })
            .collect()
    }

    #[instrument(skip(self), fields(self.key = %self.key))]
    fn html_citation(&self) -> String {
        let mut citation = String::from("");
        let authors = self
            .author()
            .inspect(|a| {
                if a.len() == 0 {
                    warn!("Bibliography entry has no authors.",);
                }
            })
            .unwrap_or_else(|err| {
                warn!(error=%err, "Error retrieving the authors.",);
                vec![]
            });

        match authors.len() {
            // If there is only one author, then the first three
            // characters of the last name are used.
            1 => citation.push_str(
                &authors[0]
                    .name
                    .chars()
                    .into_iter()
                    .take(3)
                    .collect::<String>(),
            ),
            _ => {
                for (i, author) in authors.into_iter().enumerate() {
                    // Obtain first 4 characters
                    if i < 4 {
                        citation.push_str(
                            &author
                                .name
                                .chars()
                                .next()
                                .map_or(String::from(""), |c| {
                                    c.to_string()
                                }),
                        );
                    }

                    // Add '+' if there are more authors
                    if i == 5 {
                        citation.push_str("+");
                        break;
                    }
                }
            }
        };

        // Get last two digits of year
        let year = self.date().ok().and_then(|result| match result {
            PermissiveType::Typed(date) => match date.value {
                DateValue::At(date_value) => Some(date_value.year),
                _ => None,
            },
            _ => None,
        });

        match year {
            Some(year) => {
                citation.push_str(&format!("{:02}", year % 100))
            }
            None => warn!("Could not extract date"),
        };
        citation
    }

    #[instrument(skip(self), fields(self.key = %self.key))]
    fn dump(&self) -> String {
        self.to_biblatex_string()
    }

    #[instrument(skip(self), fields(self.key = %self.key))]
    fn hash_all_information(&self) -> u64 {
        xxh3_64(self.to_biblatex_string().as_bytes())
    }

    #[instrument(skip(self), fields(self.key = %self.key))]
    fn hash_abbreviation(&self) -> u64 {
        xxh3_64(self.html_citation().as_bytes())
    }
}

pub trait HTMLBibliographyAccess: Debug {
    //! This trait fixes the functions needed from bibliography for
    //! the HTML export.

    /// Retrieves a specific entry specified by the key.
    fn get(&self, key: &str) -> Option<&dyn HTMLBibliographyEntry>;

    /// Dumps the bibliography to a string in biblatex format.
    fn dump(&self) -> String;

    /// Creates a new bibliography with the given entry added.
    fn add_bib(
        &self,
        key: &str,
        entry: &str,
    ) -> Arc<dyn HTMLBibliographyAccess + Send + Sync>;

    /// Creates a new bibliography with the given entry removed.
    fn drop_bib(
        &self,
        key: &str,
    ) -> Arc<dyn HTMLBibliographyAccess + Send + Sync>;
}

impl HTMLBibliographyAccess for Bibliography {
    fn get(&self, key: &str) -> Option<&dyn HTMLBibliographyEntry> {
        Bibliography::get(self, key)
            .map(|e| e as &dyn HTMLBibliographyEntry)
    }

    fn dump(&self) -> String {
        Bibliography::to_biblatex_string(self)
    }

    fn add_bib(
        &self,
        key: &str,
        entry: &str,
    ) -> Arc<dyn HTMLBibliographyAccess + Send + Sync> {
        Bibliography::parse(entry)
            .map_err(|err| {
                warn!(error=%err, "Error parsing the entry.");
            })
            .ok()
            .and_then(|parsed_bib| parsed_bib.get(key).cloned())
            .map(|entry| {
                let mut new_bib = self.clone();
                new_bib.insert(entry);
                Arc::new(new_bib)
                    as Arc<dyn HTMLBibliographyAccess + Send + Sync>
            })
            .unwrap_or_else(|| {
                warn!("Could not parse the entry or find the key.");
                Arc::new(self.clone())
                    as Arc<dyn HTMLBibliographyAccess + Send + Sync>
            })
    }

    fn drop_bib(
        &self,
        key: &str,
    ) -> Arc<dyn HTMLBibliographyAccess + Send + Sync> {
        let mut new_bib = self.clone();
        new_bib.remove(key);
        Arc::new(new_bib)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one_author_year_bib() -> Bibliography {
        Bibliography::parse("@book{tolkien1937, author = {J. R. R. Tolkien}, date = {1937}}")
            .unwrap()
    }

    fn four_authors_absent_year_bib() -> Bibliography {
        Bibliography::parse(
            "@InProceedings{FlushFlushGruss,
author={Gruss, Daniel and Maurice, Cl{\'e}mentine and Wagner, Klaus and Mangard, Stefan}}",
        )
        .unwrap()
    }

    fn empty_bib() -> Bibliography {
        Bibliography::parse("").unwrap()
    }

    fn many_authors_year_bib() -> Bibliography {
        Bibliography::parse("@INPROCEEDINGS{SpectreAttacksKocherEtAl,
  author={Kocher, Paul and Horn, Jann and Fogh, Anders and Genkin, Daniel and Gruss, Daniel and Haas, Werner and Hamburg, Mike and Lipp, Moritz and Mangard, Stefan and Prescher, Thomas and Schwarz, Michael and Yarom, Yuval},
  booktitle={2019 IEEE Symposium on Security and Privacy (SP)},
  title={Spectre Attacks: Exploiting Speculative Execution},
  year={2019},
  volume={},
  number={},
  pages={1-19},
  keywords={Program processors;Microarchitecture;Registers;Arrays;Transient analysis;Hardware;Side-channel attacks;Spectre;speculative-execution;microarchitecture-security;microarchitectural-attack},
  doi={10.1109/SP.2019.00002}
  }").unwrap()
    }

    fn multiple_entries_bib() -> Bibliography {
        Bibliography::parse(
            r"
@article {CohomologyCertainPELShimuraMantovan,
    AUTHOR = {Mantovan, Elena},
     TITLE = {On the cohomology of certain {PEL}-type {S}himura varieties},
   JOURNAL = {Duke Math. J.},
  FJOURNAL = {Duke Mathematical Journal},
    VOLUME = {129},
      YEAR = {2005},
    NUMBER = {3},
     PAGES = {573--610},
      ISSN = {0012-7094,1547-7398},
   MRCLASS = {11G18 (11F70 14G35 14L05)},
  MRNUMBER = {2169874},
       DOI = {10.1215/S0012-7094-05-12935-0},
       URL = {https://doi.org/10.1215/S0012-7094-05-12935-0},
}

@article {CongruenceRelationsShimuraUnitaryBueltelWedhorn,
    AUTHOR = {B\ultel, Oliver and Wedhorn, Torsten},
     TITLE = {Congruence relations for {S}himura varieties associated to
              some unitary groups},
   JOURNAL = {J. Inst. Math. Jussieu},
  FJOURNAL = {Journal of the Institute of Mathematics of Jussieu. JIMJ.
              Journal de l'Institut de Math\'ematiques de Jussieu},
    VOLUME = {5},
      YEAR = {2006},
    NUMBER = {2},
     PAGES = {229--261},
      ISSN = {1474-7480,1475-3030},
   MRCLASS = {11G18 (14G35 14K10)},
  MRNUMBER = {2225042},
       DOI = {10.1017/S1474748005000253},
       URL = {https://doi.org/10.1017/S1474748005000253},
}
  ",
        )
        .unwrap()
    }

    fn inproceedings_entry() -> Entry {
        many_authors_year_bib()
            .get("SpectreAttacksKocherEtAl")
            .unwrap()
            .clone()
    }

    fn book_entry() -> Entry {
        Bibliography::parse(
            "
@Book{AlgGeoI,
  author    = {G{\"o}rtz, U. and Wedhorn, T.},
  publisher = {Springer Fachmedien Wiesbaden},
  title     = {Algebraic Geometry I: Schemes: With Examples and Exercises},
  year      = {2020},
  isbn      = {9783658307332},
  series    = {Springer Studium Mathematik - Master},
  url       = {https://books.google.de/books?id=do7zDwAAQBAJ},
}
",
        )
        .unwrap()
        .get("AlgGeoI")
        .unwrap()
        .clone()
    }

    fn article_entry() -> Entry {
        multiple_entries_bib()
            .get("CongruenceRelationsShimuraUnitaryBueltelWedhorn")
            .unwrap()
            .clone()
    }

    fn misc_entry() -> Entry {
        Bibliography::parse(
            r"
@misc{SmashingSpectrumAoki,
      title={The smashing spectrum of sheaves},
      author={Ko Aoki},
      year={2024},
      eprint={2406.03969},
      archivePrefix={arXiv},
      primaryClass={math.CT},
      url={https://arxiv.org/abs/2406.03969},
}
  ",
        )
        .unwrap()
        .get("SmashingSpectrumAoki")
        .unwrap()
        .clone()
    }

    #[test]
    fn generate_citation_one_author_year() {
        assert_eq!(
            one_author_year_bib()
                .get("tolkien1937")
                .unwrap()
                .html_citation(),
            "Tol37".to_owned()
        );
    }

    #[test]
    fn generate_citation_four_authors_absent_year() {
        assert_eq!(
            four_authors_absent_year_bib()
                .get("FlushFlushGruss")
                .unwrap()
                .html_citation(),
            "GMWM".to_owned()
        );
    }

    #[test]
    fn generate_citation_many_authors_year() {
        assert_eq!(
            many_authors_year_bib()
                .get("SpectreAttacksKocherEtAl")
                .unwrap()
                .html_citation(),
            "KHFG+19".to_owned()
        );
    }

    #[test]
    fn generate_citation_multiple_entries() {
        assert_eq!(
            multiple_entries_bib()
                .get(
                    "CongruenceRelationsShimuraUnitaryBueltelWedhorn"
                )
                .unwrap()
                .html_citation(),
            "BW06".to_owned()
        );
    }

    #[test]
    fn get_empty() {
        assert_eq!(empty_bib().get("hello").is_none(), true);
    }

    #[test]
    fn get_not_empty() {
        assert_eq!(
            multiple_entries_bib()
                .get(
                    "CongruenceRelationsShimuraUnitaryBueltelWedhorn"
                )
                .is_none(),
            false
        );
    }

    #[test]
    fn title_book() {
        assert_eq!(
            book_entry().html_title(),
            "Algebraic Geometry I: Schemes: With Examples and Exercises".to_owned()
        );
    }

    #[test]
    fn title_inproceedings() {
        assert_eq!(
            inproceedings_entry().html_title(),
            "Spectre Attacks: Exploiting Speculative Execution"
                .to_owned()
        );
    }

    #[test]
    fn title_misc() {
        assert_eq!(
            misc_entry().html_title(),
            "The smashing spectrum of sheaves".to_owned()
        );
    }

    #[test]
    fn title_article() {
        assert_eq!(
            article_entry().html_title(),
            "Congruence relations for Shimura varieties associated to some unitary groups"
                .to_owned()
        );
    }

    #[test]
    fn year_book() {
        assert_eq!(book_entry().html_year(), Some(2020));
    }

    #[test]
    fn year_inproceedings() {
        assert_eq!(inproceedings_entry().html_year(), Some(2019));
    }

    #[test]
    fn year_misc() {
        assert_eq!(misc_entry().html_year(), Some(2024));
    }

    #[test]
    fn year_article() {
        assert_eq!(article_entry().html_year(), Some(2006));
    }

    #[test]
    fn year_absent() {
        assert_eq!(
            four_authors_absent_year_bib()
                .get("FlushFlushGruss")
                .unwrap()
                .html_year(),
            None
        );
    }

    #[test]
    fn authors_book() {
        assert_eq!(
            book_entry().html_authors(),
            vec!["U.  G\"ortz", "T.  Wedhorn"]
        );
    }

    #[test]
    fn authors_inproceedings() {
        assert_eq!(
            inproceedings_entry().html_authors(),
            vec![
                "Paul  Kocher",
                "Jann  Horn",
                "Anders  Fogh",
                "Daniel  Genkin",
                "Daniel  Gruss",
                "Werner  Haas",
                "Mike  Hamburg",
                "Moritz  Lipp",
                "Stefan  Mangard",
                "Thomas  Prescher",
                "Michael  Schwarz",
                "Yuval  Yarom"
            ]
        );
    }

    #[test]
    fn authors_misc() {
        assert_eq!(misc_entry().html_authors(), vec!["Ko  Aoki"]);
    }

    #[test]
    fn authors_article() {
        assert_eq!(
            article_entry().html_authors(),
            vec!["Oliver  B\\ultel", "Torsten  Wedhorn"]
        );
    }

    #[test]
    fn location_book() {
        assert_eq!(
            book_entry().html_location(),
            "Springer Fachmedien Wiesbaden".to_owned()
        );
    }

    #[test]
    fn location_inproceedings() {
        assert_eq!(
            inproceedings_entry().html_location(),
            "2019 IEEE Symposium on Security and Privacy (SP)"
                .to_owned()
        );
    }

    #[test]
    fn location_misc() {
        assert_eq!(misc_entry().html_location(), "".to_owned());
    }

    #[test]
    fn location_article() {
        assert_eq!(
            article_entry().html_location(),
            "J. Inst. Math. Jussieu".to_owned()
        );
    }

    #[test]
    fn key_book() {
        assert_eq!(book_entry().key(), "AlgGeoI".to_owned());
    }

    #[test]
    fn key_inproceedings() {
        assert_eq!(
            inproceedings_entry().key(),
            "SpectreAttacksKocherEtAl".to_owned()
        );
    }

    #[test]
    fn key_misc() {
        assert_eq!(
            misc_entry().key(),
            "SmashingSpectrumAoki".to_owned()
        );
    }

    #[test]
    fn key_article() {
        assert_eq!(
            article_entry().key(),
            "CongruenceRelationsShimuraUnitaryBueltelWedhorn"
                .to_owned()
        );
    }
}
