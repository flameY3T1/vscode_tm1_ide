import { describe, it, expect } from 'vitest';
import { getMdxContext, pickMembers } from '../mdx/mdxContext';

describe('getMdxContext', () => {
  it('FROM [ → cube context', () => {
    const text = 'SELECT {} ON 0 FROM [';
    expect(getMdxContext(text, text.length)).toEqual({ kind: 'cube', prefix: '' });
  });

  it('FROM [Sa → cube context with prefix', () => {
    const text = 'FROM [Sa';
    expect(getMdxContext(text, text.length)).toEqual({ kind: 'cube', prefix: 'Sa' });
  });

  it('SELECT [ (no FROM) → dim context, cube=null', () => {
    const text = 'SELECT [';
    expect(getMdxContext(text, text.length)).toEqual({ kind: 'dim', cube: null, prefix: '' });
  });

  it('SELECT [Mo after FROM [Sales] → dim context with cube', () => {
    const text = 'SELECT [Mo\nFROM [Sales]';
    const off = 'SELECT [Mo'.length;
    expect(getMdxContext(text, off)).toEqual({ kind: 'dim', cube: 'Sales', prefix: 'Mo' });
  });

  it('[Month]. → memberFunction context (no prefix)', () => {
    const text = '[Month].';
    expect(getMdxContext(text, text.length)).toEqual({ kind: 'memberFunction', dim: 'Month', prefix: '' });
  });

  it('[Month].ME → memberFunction context with prefix', () => {
    const text = '[Month].ME';
    expect(getMdxContext(text, text.length)).toEqual({ kind: 'memberFunction', dim: 'Month', prefix: 'ME' });
  });

  it('bare word SEL → function context', () => {
    const text = 'SEL';
    expect(getMdxContext(text, text.length)).toEqual({ kind: 'function', prefix: 'SEL' });
  });

  it('inside CROSSJOIN( with [ open → dim context', () => {
    const text = 'CROSSJOIN([';
    expect(getMdxContext(text, text.length)).toEqual({ kind: 'dim', cube: null, prefix: '' });
  });

  it('inside {} list with [A → dim context, prefix A', () => {
    const text = '{[A';
    expect(getMdxContext(text, text.length)).toEqual({ kind: 'dim', cube: null, prefix: 'A' });
  });

  it('completed [X].[Y] (cursor after ]) → null (no completion)', () => {
    const text = '[X].[Y]';
    expect(getMdxContext(text, text.length)).toBeNull();
  });

  it('mid-whitespace inside tuple → null', () => {
    const text = 'SELECT   ';
    expect(getMdxContext(text, text.length)).toEqual({ kind: 'function', prefix: '' });
  });

  it('empty string → null', () => {
    expect(getMdxContext('', 0)).toBeNull();
  });
});

describe('getMdxContext — member', () => {
  it('[Dim].[ → member of the default hierarchy', () => {
    const text = 'SELECT {[Month].[Ja';
    expect(getMdxContext(text, text.length)).toEqual({ kind: 'member', dim: 'Month', hier: null, prefix: 'Ja' });
  });

  it('[Dim].[Hier].[ → member of that hierarchy', () => {
    const text = 'SELECT {[Month].[Fiscal].[';
    expect(getMdxContext(text, text.length)).toEqual({ kind: 'member', dim: 'Month', hier: 'Fiscal', prefix: '' });
  });

  it('long member path still takes Dim and Hier from its first two segments', () => {
    const text = 'SELECT {[Month].[Fiscal].[Q1].[J';
    expect(getMdxContext(text, text.length)).toEqual({ kind: 'member', dim: 'Month', hier: 'Fiscal', prefix: 'J' });
  });

  it('pickMembers matches infix, ignores case, caps the list', () => {
    expect(pickMembers(['Jan', 'Feb', 'Total Jan-Mar'], 'jan')).toEqual(['Jan', 'Total Jan-Mar']);
    expect(pickMembers(['a', 'b', 'c'], '', 2)).toEqual(['a', 'b']);
  });
});
