import { stateClassFor, type ThreadStateClass } from '../commands/threadsPure';

export interface Tm1TopRow {
  threadId: string;
  session: string;
  principal: string;
  context: string;
  state: string;
  details: string[];
  elapsed: string;
  stateClass: ThreadStateClass;
}

/** Native Top embeds the login session as a numeric `:NNN` suffix on the client
 *  context (e.g. `vscode-tm1-ide/1.0.38:538`). Split it into its own column, as
 *  the REST Threads view does. Only a purely numeric tail is treated as the
 *  session, so a client name that itself contains a colon is left intact. */
function splitSession(context: string): { context: string; session: string } {
  const colon = context.lastIndexOf(':');
  if (colon <= 0) { return { context, session: '' }; }
  const tail = context.slice(colon + 1);
  if (tail === '' || !/^\d+$/.test(tail)) { return { context, session: '' }; }
  return { context: context.slice(0, colon), session: tail };
}

/** Native Top returns display strings, not REST duration values or nested arrays. */
export function parseRow(line: string): Tm1TopRow {
  const fields = line.split('\t');
  if (fields.length > 4 && fields[fields.length - 1] === '') { fields.pop(); }
  const [threadId = '', principal = '', rawContext = '', state = ''] = fields;
  const { context, session } = splitSession(rawContext);
  return {
    threadId, session, principal, context, state,
    details: fields.length > 5 ? fields.slice(4, -1) : [],
    elapsed: fields.length > 4 ? fields[fields.length - 1] : '',
    stateClass: stateClassFor(state),
  };
}

export function parseState(rows: string[]): Tm1TopRow[] {
  return rows.filter(line => line.trim() !== '').map(parseRow);
}
