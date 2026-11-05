import type { TiSection } from '../../lintTypes';

/** A TI process's four logic sections, each as raw source text. */
export type TiSections = { prolog: string; metadata: string; data: string; epilog: string };

/** Canonical section order; iterate the four sections deterministically. */
export const SECTION_ORDER: readonly TiSection[] = ['prolog', 'metadata', 'data', 'epilog'];

/**
 * Matches a single identifier token (not part of a longer ident). Global-flagged,
 * so reset `IDENT_RE.lastIndex = 0` before each `exec` loop on fresh input.
 */
export const IDENT_RE = /(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*(?![A-Za-z0-9_])/g;
