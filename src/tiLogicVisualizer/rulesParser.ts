export interface ParsedRulesLine {
  lineIndex: number;
  raw: string;
  trimmed: string;
  isComment: boolean;
  isBlank: boolean;
  isSkipcheck: boolean;
  isFeedstrings: boolean;
  isUndefvals: boolean;
  isFeedersMarker: boolean;
  section: 'rules' | 'feeders';
}

export interface RulesAst {
  lines: ParsedRulesLine[];
  hasSkipcheck: boolean;
  skipchecLine: number;
  feedersLineIndex: number;
  feedersCount: number;
}

export function parseRules(text: string): RulesAst {
  const rawLines = text.split('\n');
  let feedersCount = 0;
  let feedersLineIndex = -1;
  let hasSkipcheck = false;
  let skipchecLine = -1;
  let inFeeders = false;

  const lines: ParsedRulesLine[] = rawLines.map((raw, lineIndex) => {
    const trimmed = raw.replace(/\r$/, '').trim();
    const isComment = trimmed.startsWith('#');
    const isBlank = trimmed === '';
    // Section markers routinely carry a trailing comment: `SKIPCHECK; # leaf cells only`.
    // Testing `trimmed` made those markers invisible — which turned a legal line into a
    // hard parse-error, and for `FEEDERS;` pushed the whole rest of the file into the
    // `rules` section, where every feeder line was then checked as a rule.
    const marker = trimmed.replace(/#.*$/, '').trim();
    const isSkipcheck = /^skipcheck\s*;?\s*$/i.test(marker);
    const isFeedstrings = /^feedstrings\s*;?\s*$/i.test(marker);
    const isUndefvals = /^undefvals\s*;?\s*$/i.test(marker);
    const isFeedersMarker = /^feeders\s*;?\s*$/i.test(marker);

    if (isSkipcheck && !hasSkipcheck) {
      hasSkipcheck = true;
      skipchecLine = lineIndex;
    }
    if (isFeedersMarker) {
      feedersCount++;
      if (feedersCount === 1) { feedersLineIndex = lineIndex; }
      inFeeders = true;
    }

    return {
      lineIndex,
      raw,
      trimmed,
      isComment,
      isBlank,
      isSkipcheck,
      isFeedstrings,
      isUndefvals,
      isFeedersMarker,
      section: inFeeders ? 'feeders' : 'rules',
    };
  });

  return { lines, hasSkipcheck, skipchecLine, feedersLineIndex, feedersCount };
}
