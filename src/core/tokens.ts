/**
 * Tokenisation and query parsing.
 *
 * This is the vocabulary of the whole search feature, so it is one module with one opinion: what a
 * word is, what is ignored, and what a user's query means. Everything else - the index, the ranking,
 * the UI - consumes these functions, so a change here changes search everywhere and nowhere else.
 */

/**
 * Words that carry no signal in a document of any size, and would otherwise flood the index: an
 * inverted index that spends its space on "the" is a slower index that ranks worse.
 *
 * Deliberately short. Aggressive stop-word lists break real queries ("how to" in a title, "it" in a
 * product name), and the ranking formula already discounts common words by itself.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'if', 'in',
  'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'then', 'there', 'these',
  'they', 'this', 'to', 'was', 'were', 'will', 'with',
]);

/**
 * Every word in `text`, in order, stop words included.
 *
 * Indexing drops stop words because they carry no signal. *Verifying a phrase* must not, because
 * inside quotes the user is naming a sequence of words: `"the state of the art"` is not the query
 * `"state art"`. Two tokenizers would drift apart, so there is one, and the indexer filters it.
 *
 * Words are runs of letters and digits, with apostrophes and internal hyphens kept so "don't" and
 * "state-of-the-art" stay whole; everything else separates. Single characters are dropped except
 * digits, because "a" is noise but "5" is a version or a year.
 */
export function tokenizeAll(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const token = match[0].replace(/['’-]+$/, '');
    if (token.length < 2 && !/\d/.test(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

/** The words worth indexing: every word except the ones that would flood the index. */
export function tokenize(text: string): string[] {
  return tokenizeAll(text).filter((token) => !STOP_WORDS.has(token));
}

/** What a user typed, reduced to what search can act on. */
export interface ParsedQuery {
  /** Individual words, in the order they appeared, deduplicated. */
  terms: string[];
  /** Quoted runs, each an ordered list of tokens that must appear adjacent in that order. */
  phrases: string[][];
  /** True when the query had words but every one of them was a stop word ("the", "and"). */
  allStopWords: boolean;
}

/**
 * Parses a query into terms and quoted phrases.
 *
 * `shelf "exact phrase" report` becomes the terms `shelf`, `report` (both required) plus the phrase
 * `exact phrase` (also required, but matched as a sequence). Quotes are the only syntax: anything
 * cleverer belongs in a UI, not in a search box nobody has read the docs for.
 */
export function parseQuery(input: string): ParsedQuery {
  const phrases: string[][] = [];
  let remainder = input;

  // Every quoted run is extracted first, so a quoted stop word ("the who") survives - inside quotes
  // the user is naming a sequence, not searching for words.
  remainder = remainder.replace(/"([^"]*)"/g, (_whole, quoted: string) => {
    const tokens = tokenizeAll(quoted);
    if (tokens.length > 0) phrases.push(tokens);
    return ' ';
  });

  const terms = [...new Set(tokenize(remainder))];
  const hadWords = /[\p{L}\p{N}]/u.test(input);

  return { terms, phrases, allStopWords: terms.length === 0 && phrases.length === 0 && hadWords };
}

/** Every token a query requires, whether from a term or a phrase - what the index must contain. */
export function requiredTokens(query: ParsedQuery): string[] {
  return [...new Set([...query.terms, ...query.phrases.flat()])];
}

/**
 * The tokens a query requires *of the index*.
 *
 * Stop words are never indexed - that is what keeps the index small - so requiring them of it would
 * make every phrase containing one permanently unsearchable: `"state of the art"` would match
 * nothing, in any archive, forever. The phrase itself is still verified against the page's own text,
 * stop words and all, which is where those words actually matter.
 */
export function indexableTokens(query: ParsedQuery): string[] {
  return requiredTokens(query).filter((token) => tokenize(token).length > 0);
}
