import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setRecentRecorder, recordProcessOpen, recordRuleOpen } from '../../commands/processEditor/recentBridge';

describe('recentBridge', () => {
  beforeEach(() => {
    // reset to a no-op recorder between tests
    setRecentRecorder(() => { /* noop */ });
  });

  it('forwards kind + serverId + name to the registered recorder', () => {
    const rec = vi.fn();
    setRecentRecorder(rec);
    recordProcessOpen('srv1', 'Load.Sales');
    expect(rec).toHaveBeenCalledWith('process', 'srv1', 'Load.Sales');
  });

  it('records a rule open under the rule kind', () => {
    const rec = vi.fn();
    setRecentRecorder(rec);
    recordRuleOpen('srv1', 'Sales');
    expect(rec).toHaveBeenCalledWith('rule', 'srv1', 'Sales');
  });

  it('is a no-op when serverId is missing', () => {
    const rec = vi.fn();
    setRecentRecorder(rec);
    recordProcessOpen(undefined, 'Load.Sales');
    recordRuleOpen(undefined, 'Sales');
    expect(rec).not.toHaveBeenCalled();
  });

  it('is a no-op when name is empty', () => {
    const rec = vi.fn();
    setRecentRecorder(rec);
    recordProcessOpen('srv1', '');
    recordRuleOpen('srv1', '');
    expect(rec).not.toHaveBeenCalled();
  });
});
