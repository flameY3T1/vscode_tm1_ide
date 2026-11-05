import { describe, it, expect } from 'vitest';
import {
  groupServersByFolder,
  addFolder,
  renameFolder,
  deleteFolder,
  assignFolder,
  type ServerLike,
} from '../../serverState/serverFoldersPure';

const srv = (id: string, name: string, folder?: string): ServerLike => ({ id, name, folder });

describe('groupServersByFolder', () => {
  it('returns no folders and flat ungrouped when nothing is assigned', () => {
    const servers = [srv('2', 'Bravo'), srv('1', 'Alpha')];
    const r = groupServersByFolder(servers, []);
    expect(r.folders).toEqual([]);
    expect(r.ungrouped.map(s => s.name)).toEqual(['Alpha', 'Bravo']); // alpha sorted
  });

  it('groups assigned servers and keeps unassigned flat', () => {
    const servers = [
      srv('1', 'Alpha', 'Prod'),
      srv('2', 'Bravo'),
      srv('3', 'Charlie', 'Prod'),
      srv('4', 'Delta', 'Test'),
    ];
    const r = groupServersByFolder(servers, []);
    expect(r.folders.map(f => f.name)).toEqual(['Prod', 'Test']); // alpha
    expect(r.folders[0].servers.map(s => s.name)).toEqual(['Alpha', 'Charlie']);
    expect(r.folders[1].servers.map(s => s.name)).toEqual(['Delta']);
    expect(r.ungrouped.map(s => s.name)).toEqual(['Bravo']);
  });

  it('persists an empty folder listed in folderList (no servers)', () => {
    const r = groupServersByFolder([srv('1', 'Alpha')], ['Empty']);
    expect(r.folders).toEqual([{ name: 'Empty', servers: [] }]);
    expect(r.ungrouped.map(s => s.name)).toEqual(['Alpha']);
  });

  it('creates a folder from a server.folder value not present in folderList', () => {
    const r = groupServersByFolder([srv('1', 'Alpha', 'Ghost')], []);
    expect(r.folders.map(f => f.name)).toEqual(['Ghost']);
    expect(r.ungrouped).toEqual([]);
  });

  it('unions folderList with distinct server folders', () => {
    const r = groupServersByFolder([srv('1', 'Alpha', 'B')], ['A', 'B', 'C']);
    expect(r.folders.map(f => f.name)).toEqual(['A', 'B', 'C']);
    expect(r.folders.find(f => f.name === 'B')!.servers.map(s => s.name)).toEqual(['Alpha']);
  });

  it('does not mutate the input array', () => {
    const servers = [srv('2', 'Bravo'), srv('1', 'Alpha')];
    groupServersByFolder(servers, []);
    expect(servers.map(s => s.name)).toEqual(['Bravo', 'Alpha']);
  });
});

describe('addFolder', () => {
  it('appends a trimmed new name', () => {
    expect(addFolder([], '  Prod ')).toEqual(['Prod']);
  });
  it('is a no-op for a duplicate', () => {
    expect(addFolder(['Prod'], 'Prod')).toEqual(['Prod']);
  });
  it('is a no-op for an empty/whitespace name', () => {
    expect(addFolder(['Prod'], '   ')).toEqual(['Prod']);
    expect(addFolder(['Prod'], '')).toEqual(['Prod']);
  });
});

describe('renameFolder', () => {
  it('renames in the list and reassigns servers', () => {
    const r = renameFolder(['Prod', 'Test'], [srv('1', 'A', 'Prod'), srv('2', 'B', 'Test')], 'Prod', 'Production');
    expect(r.folders).toEqual(['Production', 'Test']);
    expect(r.servers.find(s => s.id === '1')!.folder).toBe('Production');
    expect(r.servers.find(s => s.id === '2')!.folder).toBe('Test');
  });
  it('dedupes when renaming onto an existing folder', () => {
    const r = renameFolder(['Prod', 'Test'], [srv('1', 'A', 'Prod')], 'Prod', 'Test');
    expect(r.folders).toEqual(['Test']);
    expect(r.servers[0].folder).toBe('Test');
  });
  it('is a no-op on empty new name', () => {
    const r = renameFolder(['Prod'], [srv('1', 'A', 'Prod')], 'Prod', '  ');
    expect(r.folders).toEqual(['Prod']);
    expect(r.servers[0].folder).toBe('Prod');
  });
});

describe('deleteFolder', () => {
  it('removes the folder and unassigns its servers', () => {
    const r = deleteFolder(['Prod', 'Test'], [srv('1', 'A', 'Prod'), srv('2', 'B', 'Test')], 'Prod');
    expect(r.folders).toEqual(['Test']);
    expect(r.servers.find(s => s.id === '1')!.folder).toBeUndefined();
    expect(r.servers.find(s => s.id === '2')!.folder).toBe('Test');
  });
});

describe('assignFolder', () => {
  it('assigns a folder to a server by id', () => {
    const r = assignFolder([srv('1', 'A'), srv('2', 'B')], '1', 'Prod');
    expect(r.find(s => s.id === '1')!.folder).toBe('Prod');
    expect(r.find(s => s.id === '2')!.folder).toBeUndefined();
  });
  it('clears the folder when passed undefined or empty', () => {
    expect(assignFolder([srv('1', 'A', 'Prod')], '1', undefined)[0].folder).toBeUndefined();
    expect(assignFolder([srv('1', 'A', 'Prod')], '1', '')[0].folder).toBeUndefined();
  });
});
