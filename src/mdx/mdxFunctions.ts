export interface MdxFunction {
  name: string;
  /** Monaco snippet body — uses $1..$n placeholders. */
  snippet: string;
  detail?: string;
}

export const MDX_KEYWORDS: string[] = [
  'SELECT', 'FROM', 'WHERE', 'WITH', 'AS',
  'ON', 'COLUMNS', 'ROWS', 'PAGES', 'CHAPTERS', 'SECTIONS', 'AXIS',
  'NON', 'EMPTY', 'NOT', 'AND', 'OR', 'XOR',
  'SET', 'MEMBER',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'IS', 'NULL',
];

export const MDX_SET_FUNCTIONS: MdxFunction[] = [
  { name: 'MEMBERS',      snippet: 'MEMBERS' },
  { name: 'CHILDREN',     snippet: 'CHILDREN' },
  { name: 'DESCENDANTS',  snippet: 'DESCENDANTS(${1:set}, ${2:level})' },
  { name: 'ANCESTORS',    snippet: 'ANCESTORS(${1:member}, ${2:distance})' },
  { name: 'ANCESTOR',     snippet: 'ANCESTOR(${1:member}, ${2:level})' },
  { name: 'HIERARCHIZE',  snippet: 'HIERARCHIZE(${1:set})' },
  { name: 'ORDER',        snippet: 'ORDER(${1:set}, ${2:expression}, ${3:BASC})' },
  { name: 'FILTER',       snippet: 'FILTER(${1:set}, ${2:condition})' },
  { name: 'DISTINCT',     snippet: 'DISTINCT(${1:set})' },
  { name: 'GENERATE',     snippet: 'GENERATE(${1:set1}, ${2:set2})' },
  { name: 'CROSSJOIN',    snippet: 'CROSSJOIN(${1:set1}, ${2:set2})' },
  { name: 'UNION',        snippet: 'UNION(${1:set1}, ${2:set2})' },
  { name: 'INTERSECT',    snippet: 'INTERSECT(${1:set1}, ${2:set2})' },
  { name: 'EXCEPT',       snippet: 'EXCEPT(${1:set1}, ${2:set2})' },
  { name: 'EXISTS',       snippet: 'EXISTS(${1:set1}, ${2:set2})' },
  { name: 'LEAVES',       snippet: 'LEAVES(${1:level})' },
  { name: 'HEAD',         snippet: 'HEAD(${1:set}, ${2:count})' },
  { name: 'TAIL',         snippet: 'TAIL(${1:set}, ${2:count})' },
  { name: 'SUBSET',       snippet: 'SUBSET(${1:set}, ${2:start}, ${3:count})' },
  { name: 'BOTTOMCOUNT',  snippet: 'BOTTOMCOUNT(${1:set}, ${2:count}, ${3:numeric})' },
  { name: 'TOPCOUNT',     snippet: 'TOPCOUNT(${1:set}, ${2:count}, ${3:numeric})' },
  { name: 'TOPPERCENT',   snippet: 'TOPPERCENT(${1:set}, ${2:pct}, ${3:numeric})' },
];

export const MDX_TUPLE_FUNCTIONS: MdxFunction[] = [
  { name: 'IIF',          snippet: 'IIF(${1:cond}, ${2:thenExpr}, ${3:elseExpr})' },
  { name: 'PARENT',       snippet: 'PARENT' },
  { name: 'SUM',          snippet: 'SUM(${1:set}, ${2:numericExpr})' },
  { name: 'AVG',          snippet: 'AVG(${1:set}, ${2:numericExpr})' },
  { name: 'MIN',          snippet: 'MIN(${1:set}, ${2:numericExpr})' },
  { name: 'MAX',          snippet: 'MAX(${1:set}, ${2:numericExpr})' },
  { name: 'COUNT',        snippet: 'COUNT(${1:set})' },
  { name: 'YTD',          snippet: 'YTD(${1:member})' },
  { name: 'QTD',          snippet: 'QTD(${1:member})' },
  { name: 'PARALLELPERIOD', snippet: 'PARALLELPERIOD(${1:level}, ${2:index}, ${3:member})' },
  { name: 'LAG',          snippet: 'LAG(${1:index})' },
  { name: 'LEAD',         snippet: 'LEAD(${1:index})' },
];

export const TM1_FUNCTIONS: MdxFunction[] = [
  { name: 'TM1SUBSETALL',       snippet: 'TM1SUBSETALL(${1:dimension})' },
  { name: 'TM1FILTERBYLEVEL',   snippet: 'TM1FILTERBYLEVEL(${1:set}, ${2:level})' },
  { name: 'TM1FILTERBYPATTERN', snippet: 'TM1FILTERBYPATTERN(${1:set}, ${2:pattern})' },
  { name: 'TM1SUBSETTOSET',     snippet: 'TM1SUBSETTOSET(${1:dimension}, ${2:subset})' },
  { name: 'TM1DRILLDOWNMEMBER', snippet: 'TM1DRILLDOWNMEMBER(${1:set}, ${2:set_filter})' },
];

export const MEMBER_PROPERTIES: string[] = [
  'Members', 'Children', 'Parent', 'FirstChild', 'LastChild',
  'FirstSibling', 'LastSibling', 'PrevMember', 'NextMember',
  'CurrentMember', 'DefaultMember', 'Properties',
  'Level', 'Hierarchy', 'Dimension', 'Name', 'UniqueName',
];

export const ALL_FUNCTIONS: MdxFunction[] = [
  ...MDX_SET_FUNCTIONS,
  ...MDX_TUPLE_FUNCTIONS,
  ...TM1_FUNCTIONS,
];
