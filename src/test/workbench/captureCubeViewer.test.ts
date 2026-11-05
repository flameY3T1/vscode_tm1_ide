import { describe, it, expect, beforeEach } from 'vitest';
import { _activeInlineMdx } from '../../commands/cubeViewer/state';
import { readCubeViewerState } from '../../commands/workbench/captureCubeViewer';

describe('readCubeViewerState', () => {
  beforeEach(() => _activeInlineMdx.clear());

  // Click test 2026-08-24 (workbench "test2view"): the expression used to come back
  // INSTEAD of the view name. Two Cube Viewers on the same cube —
  // one on the cube, one on a view — then looked the same, and
  // on restore both built the same panel key
  // (`${server}:${cube}`). The second call found the first panel and turned
  // it into a `reveal()`: only ONE window opened.
  //
  // The view name is part of the window's IDENTITY, the expression only its
  // content. Both must stand side by side.
  it('keeps the view name ALONGSIDE the active inline MDX', () => {
    _activeInlineMdx.set('https://h:12354:Reporting:GuV', 'SELECT ...');
    expect(readCubeViewerState('https://h:12354:Reporting:GuV', 'Reporting'))
      .toEqual({ mdx: 'SELECT ...', viewName: 'GuV', isPrivate: undefined });
  });

  it('also keeps the private view name alongside the MDX', () => {
    _activeInlineMdx.set('https://h:12354:Reporting:GuV:priv', 'SELECT ...');
    expect(readCubeViewerState('https://h:12354:Reporting:GuV:priv', 'Reporting'))
      .toEqual({ mdx: 'SELECT ...', viewName: 'GuV', isPrivate: true });
  });

  it('returns only the MDX for a cube panel', () => {
    _activeInlineMdx.set('https://h:12354:Reporting', 'SELECT ...');
    expect(readCubeViewerState('https://h:12354:Reporting', 'Reporting'))
      .toEqual({ mdx: 'SELECT ...' });
  });

  it('reads the view name out of the key', () => {
    expect(readCubeViewerState('https://h:12354:Reporting:GuV', 'Reporting'))
      .toEqual({ viewName: 'GuV', isPrivate: undefined });
  });

  it('reads a private view', () => {
    expect(readCubeViewerState('https://h:12354:Reporting:GuV:priv', 'Reporting'))
      .toEqual({ viewName: 'GuV', isPrivate: true });
  });

  it('returns nothing for a cube-only panel', () => {
    expect(readCubeViewerState('https://h:12354:Reporting', 'Reporting')).toEqual({});
  });

  // The reason for the `target` parameter: without a port a cube panel has just as
  // many colons as a view panel with a port. A check for port digits
  // would take the cube name for a view here and invent one that does not exist.
  it('does not invent a view when the server URL carries no port', () => {
    expect(readCubeViewerState('https://h:Reporting', 'Reporting')).toEqual({});
  });

  it('returns nothing when the target is unknown', () => {
    expect(readCubeViewerState('https://h:12354:Reporting:GuV', undefined)).toEqual({});
  });
});
