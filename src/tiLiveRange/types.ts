import type { VarBinding } from '../references/variableEnv';
import type { TiAst } from '../tiLogicVisualizer/types';
import type { UnitKey } from '../tiConsistency/types';

export interface Pos { line: number; column: number } // 1-based, COMBINED-doc coords

export interface Def {
  id: number;
  line: number;
  lhs: Pos;
  binding: VarBinding;
  isLiteralString: boolean; // literal binding AND raw RHS starts with a quote
  value?: string;
}

export interface ReadOcc { occ: Pos; line: number }

export interface Analysis { defs: Def[]; reads: ReadOcc[]; ast: TiAst }

export interface LiveRange { defId: number; positions: Pos[]; refused?: string }

export interface DefView { defId: number; unit: UnitKey; line: number; value?: string; binding: string; splittable: boolean; refused?: string }
export interface MultiValueVar { process: string; varName: string; varLc: string; defs: DefView[] }
