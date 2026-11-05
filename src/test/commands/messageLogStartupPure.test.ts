import { describe, it, expect } from 'vitest';
import { parseStartupLine } from '../../commands/messageLogStartupPure';

/**
 * Every string below is VERBATIM from a real server — the English ones from a
 * 29560-line production `tm1server.log`, the German ones read off the live 11.8
 * test server. TM1 mixes the two: `TM1 Server is ready` and the feeder lines stay
 * English even on a server whose cube and dimension lines are German.
 */
describe('parseStartupLine — English forms', () => {
  it('recognises the startup boundary', () => {
    expect(parseStartupLine('Data Directory: c:\\tm1\\tm1-aula\\01_daten')).toEqual({ type: 'begin' });
  });
  it('reads the reported total', () => {
    expect(parseStartupLine('TM1 Server is ready, elapsed time 3490.00 seconds'))
      .toEqual({ type: 'ready', elapsedSec: 3490 });
  });
  it('reads the second total TM1 writes', () => {
    expect(parseStartupLine('TM1 Server load time (secs) = 3486'))
      .toEqual({ type: 'loadTime', sec: 3486 });
  });
  it('reads the MTQ degree', () => {
    expect(parseStartupLine('MTQ is enabled with 16 threads')).toEqual({ type: 'mtq', threads: 16 });
  });
  it('pairs a cube body', () => {
    expect(parseStartupLine('Loading body for cube Verspaetungen'))
      .toEqual({ type: 'bodyStart', name: 'Verspaetungen' });
    expect(parseStartupLine('Done loading body for cube Verspaetungen'))
      .toEqual({ type: 'bodyEnd', name: 'Verspaetungen' });
  });
  it('recognises a cube header, which has no start line', () => {
    expect(parseStartupLine('Done loading header for cube z_Doku_Prozesse'))
      .toEqual({ type: 'headEnd', name: 'z_Doku_Prozesse' });
  });
  it('recognises a dimension, which has no end line', () => {
    expect(parseStartupLine('Loading dimension Wertfeld_z_Doku_Prozesse'))
      .toEqual({ type: 'dimension', name: 'Wertfeld_z_Doku_Prozesse' });
  });
  it('recognises rules loading', () => {
    expect(parseStartupLine('Loading rules for cube }ElementAttributes_Wertfeld'))
      .toEqual({ type: 'rules', name: '}ElementAttributes_Wertfeld' });
  });
  it('takes the feeder runtime out of the message text', () => {
    // The only phase whose duration TM1 states itself — no arithmetic needed.
    expect(parseStartupLine("TM1CubeImpl::ProcessFeeders(in 352977ms): Done computing feeders for base cube 'Reporting_Zuverlaessigkeitsgrad_KM_SBI'."))
      .toEqual({ type: 'feederDone', name: 'Reporting_Zuverlaessigkeitsgrad_KM_SBI', ms: 352977 });
  });
  it('recognises feeders read from file instead of computed', () => {
    expect(parseStartupLine('Feeders already loaded for cube "Plan_Staff"'))
      .toEqual({ type: 'feederFromFile', name: 'Plan_Staff' });
    expect(parseStartupLine("TM1CubeImpl::LoadFeeders: Loading feeders for cube 'Reporting' from saved feeders file."))
      .toEqual({ type: 'feederFromFile', name: 'Reporting' });
  });
  it('recognises the persistent-feeders switch', () => {
    expect(parseStartupLine('Using Persistent Feeders')).toEqual({ type: 'persistentFeeders' });
  });
});

describe('parseStartupLine — German forms', () => {
  it('pairs a cube body', () => {
    expect(parseStartupLine('Hauptteil für Cube }StatsForServer wird geladen'))
      .toEqual({ type: 'bodyStart', name: '}StatsForServer' });
    expect(parseStartupLine('Laden des Hauptteils für Cube }StatsForServer abgeschlossen'))
      .toEqual({ type: 'bodyEnd', name: '}StatsForServer' });
  });
  it('does not confuse the header end with the body end — both say "Laden … abgeschlossen"', () => {
    expect(parseStartupLine('Laden der Kopfzeile für Cube Plan_Cost abgeschlossen.'))
      .toEqual({ type: 'headEnd', name: 'Plan_Cost' });
  });
  it('reads a dimension name out of its quotes', () => {
    expect(parseStartupLine("Dimension 'AllocCostCenters' wird geladen"))
      .toEqual({ type: 'dimension', name: 'AllocCostCenters' });
  });
  it('recognises rules loading', () => {
    expect(parseStartupLine('Regeln für Cube Plan_Staff werden geladen.'))
      .toEqual({ type: 'rules', name: 'Plan_Staff' });
  });
  it('reads the MTQ degree', () => {
    expect(parseStartupLine('MTQ mit 12 Threads aktiviert')).toEqual({ type: 'mtq', threads: 12 });
  });
  it('reads the cube-loading thread count', () => {
    expect(parseStartupLine('MaximumCubeLoadThreads ist auf 8 festgelegt'))
      .toEqual({ type: 'cubeLoadThreads', threads: 8 });
    expect(parseStartupLine('8 Threads zum Laden von Cubes werden gestartet'))
      .toEqual({ type: 'cubeLoadThreads', threads: 8 });
  });
});

describe('parseStartupLine — what must NOT match', () => {
  it('ignores an ordinary process line', () => {
    expect(parseStartupLine('Process "P" executed by user "U"')).toBeNull();
  });
  it('ignores the config lines that merely mention a keyword', () => {
    expect(parseStartupLine('CheckFeedersMaximumCells is set to 3000000')).toBeNull();
    expect(parseStartupLine('PersistentFeeders is disabled')).toBeNull();
  });
  it('ignores the feeder START line, which carries no runtime', () => {
    // Only the `(in Nms)` half is a measurement; the opening line would double-count.
    expect(parseStartupLine("TM1CubeImpl::ProcessFeeders: Computing feeders for base cube 'X'."))
      .toBeNull();
  });
  it('keeps a cube name that contains spaces intact', () => {
    expect(parseStartupLine('Loading body for cube My Cube With Spaces'))
      .toEqual({ type: 'bodyStart', name: 'My Cube With Spaces' });
    expect(parseStartupLine('Hauptteil für Cube My Cube With Spaces wird geladen'))
      .toEqual({ type: 'bodyStart', name: 'My Cube With Spaces' });
  });
});
