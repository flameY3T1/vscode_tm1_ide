// src/serverConfig/configClassifier.ts
import { lookupSchema, type Cluster } from './paramSchema';

export interface Classification {
  cluster: Cluster;
  isStatic: boolean;
  requiresRestart: boolean;
  readonly: boolean;
  known: boolean;
}

export function classify(name: string): Classification {
  const def = lookupSchema(name);
  if (!def) {
    return { cluster: 'misc', isStatic: false, requiresRestart: false, readonly: false, known: false };
  }
  return {
    cluster: def.cluster,
    isStatic: def.isStatic,
    requiresRestart: def.requiresRestart,
    readonly: def.readonly === true,
    known: true,
  };
}
