// Person-name formatting shared across modules (fee receipts, message greetings,
// etc.). One source of truth so the title-stripping rules can't drift per module.

// Leading honorifics stripped before greeting someone by name. Kept conservative
// (parent/guardian titles only) so name components like "Mohd"/"Md" survive.
//   * longest-first + \b so "Mrs.Upasana" strips "Mrs." (not "Mr" -> "s.Upasana"),
//     and a name that merely STARTS with a title ("Srishti", "Mrinal", "Kumar")
//     is left intact — the \b requires a boundary (space/dot/end) after the title.
//   * handles a glued dot with no following space ("Mr.Ranjeet") and repeated
//     titles ("Late Sri Ram Verma" -> "Ram").
const TITLE_RE = /^(master|mrs|smt|shri|miss|prof|late|sri|kum|m\/s|mr|ms|dr)\b\.?\s*/i;

// Remove any leading honorific(s) from a full name; returns the trimmed remainder
// (falls back to the trimmed original if stripping would leave nothing).
export function stripTitle(full: any): string {
  const original = String(full == null ? '' : full).trim();
  if (!original) return '';
  let s = original;
  let prev = '';
  while (s && s !== prev) { prev = s; s = s.replace(TITLE_RE, '').trim(); }
  return s || original;
}

// Reduce a full name to a clean first name for greetings: drop the title, then
// take the first whitespace-delimited token. "Mr. Vikas Katiyar" -> "Vikas".
export function firstName(full: any): string {
  const s = stripTitle(full);
  return s.split(/\s+/)[0] || s;
}
