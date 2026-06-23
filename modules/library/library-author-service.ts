import {
  HONORIFICS,
  NAME_SUFFIXES,
  DEVANAGARI_TO_ROMAN,
} from "./library-constants";
import { NormalizedAuthor, NormalizeAuthorResult } from "./library-interfaces";

// Author name normalization.
//
// Goal: accept free-text author entry and produce a non-destructive preview of
// the surname-first form plus the 3-letter Roman Cutter used in the call number.
// Nothing here is silently persisted - the handler returns this for the
// cataloguer to confirm/correct.
//
// Multiple authors are separated by comma, semicolon, " and " or "&". Each
// author is reordered to "Surname Forename" (surname first, space-separated).
// The combined display joins authors with ", ". The Cutter comes from the first
// author's surname.

const HONORIFIC_SET = new Set(HONORIFICS.map((h) => h.toLowerCase()));
const SUFFIX_SET = new Set(NAME_SUFFIXES.map((s) => s.toLowerCase()));

class AuthorService {
  // Transliterate a (possibly Devanagari) string to Roman and return the first
  // `n` alphabetic characters, uppercased - the Cutter author mark.
  public toRomanCutter(surname: string, n = 3): string {
    if (!surname) return "";
    let roman = "";
    for (const ch of surname) {
      roman +=
        DEVANAGARI_TO_ROMAN[ch] !== undefined ? DEVANAGARI_TO_ROMAN[ch] : ch;
    }
    const alpha = roman.replace(/[^a-zA-Z]/g, "");
    return alpha.slice(0, n).toUpperCase();
  }

  private stripAffixes(tokens: string[]): string[] {
    let out = [...tokens];
    // strip a leading honorific (with or without trailing dot)
    while (out.length > 1) {
      const first = out[0].replace(/\.$/, "").toLowerCase();
      if (HONORIFIC_SET.has(first)) {
        out = out.slice(1);
      } else {
        break;
      }
    }
    // strip a trailing suffix
    while (out.length > 1) {
      const last = out[out.length - 1].replace(/[.,]$/, "").toLowerCase();
      if (SUFFIX_SET.has(last)) {
        out = out.slice(0, -1);
      } else {
        break;
      }
    }
    return out;
  }

  // Normalize a single author name into "Surname Forename" + Cutter.
  public normalizeOne(raw: string): NormalizedAuthor {
    const trimmed = (raw || "").trim().replace(/\s+/g, " ");
    if (!trimmed) {
      return { display: "", surname: "", forename: "", cutter: "" };
    }

    const tokens = this.stripAffixes(trimmed.split(" "));
    let surname: string;
    let forename: string;
    if (tokens.length === 1) {
      surname = tokens[0];
      forename = "";
    } else {
      surname = tokens[tokens.length - 1];
      forename = tokens.slice(0, -1).join(" ");
    }

    const display = forename ? `${surname} ${forename}` : surname;
    return { display, surname, forename, cutter: this.toRomanCutter(surname) };
  }

  // Split a free-text author string into individual author names. Comma,
  // semicolon, " and " and "&" all separate authors.
  private splitAuthors(input: string): string[] {
    return (input || "")
      .trim()
      .split(/\s*[;,]\s*|\s+and\s+|\s*&\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  public normalize(input: string): NormalizeAuthorResult {
    const parts = this.splitAuthors(input);
    const authors = parts
      .map((p) => this.normalizeOne(p))
      .filter((a) => a.surname);
    const first = authors[0] || {
      display: "",
      surname: "",
      forename: "",
      cutter: "",
    };
    return {
      input,
      authors,
      authorDisplay: authors.map((a) => a.display).join(", "),
      firstAuthorSurname: first.surname,
      cutter: first.cutter,
    };
  }
}

export const authorService = new AuthorService();
