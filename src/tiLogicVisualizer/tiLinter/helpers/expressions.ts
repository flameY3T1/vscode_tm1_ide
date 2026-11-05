import { KNOWN_SIGNATURES } from '../../tiSignatures';
import { VariableType, VariableTypeMap } from '../../lintTypes';
import { splitByCommaAtDepthZero } from './parse';

/**
 * Check if a string is a TI string literal (enclosed in single quotes).
 */
export function isStringLiteral(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'");
}

/**
 * Check if a string is a numeric literal.
 * Matches integers, decimals, and negative numbers.
 */
export function isNumericLiteral(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  return /^-?\d+(\.\d+)?$/.test(trimmed);
}

/**
 * Resolves the type of a simple operand (string literal, numeric literal,
 * or a known variable). Returns undefined for complex expressions.
 */
export function inferSideType(expr: string, variableTypes: VariableTypeMap): VariableType | undefined {
  if (isStringLiteral(expr)) { return 'string'; }
  if (isNumericLiteral(expr)) { return 'numeric'; }
  if (/^[A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*$/.test(expr)) {
    return variableTypes.get(expr.toLowerCase())?.type;
  }
  return undefined;
}

/**
 * Infer the type of a TI expression.
 * Returns 'string', 'numeric', or undefined if the type cannot be determined.
 */
export function inferExpressionType(
  expression: string,
  variableTypes: VariableTypeMap,
): VariableType | undefined {
  const trimmed = expression.trim();

  if (isStringLiteral(trimmed)) {
    return 'string';
  }
  if (isNumericLiteral(trimmed)) {
    return 'numeric';
  }

  const inlineIfType = inferInlineIfType(trimmed, variableTypes);
  if (inlineIfType) {
    return inlineIfType;
  }

  const funcType = inferFunctionCallType(trimmed);
  if (funcType) {
    return funcType === 'void' ? undefined : funcType;
  }

  const varType = inferVariableType(trimmed, variableTypes);
  if (varType) {
    return varType;
  }

  return undefined;
}

/**
 * Infer the type of an inline IF expression: IF(condition, trueValue, falseValue).
 * The type is determined by the true-value (val1).
 */
function inferInlineIfType(
  expression: string,
  variableTypes: VariableTypeMap,
): VariableType | undefined {
  const upper = expression.toUpperCase();
  if (!upper.startsWith('IF') || !upper.match(/^IF\s*\(/)) {
    return undefined;
  }

  const parenStart = expression.indexOf('(');
  if (parenStart === -1) return undefined;

  let depth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < expression.length; i++) {
    if (expression[i] === '(') depth++;
    if (expression[i] === ')') {
      depth--;
      if (depth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  if (parenEnd === -1) return undefined;

  const inner = expression.substring(parenStart + 1, parenEnd);
  const parts = splitByCommaAtDepthZero(inner);

  if (parts.length < 2) return undefined;

  const trueValue = parts[1].trim();
  return inferExpressionType(trueValue, variableTypes);
}

/**
 * Infer the return type of a function call expression.
 * Returns the returnType from KNOWN_SIGNATURES, or undefined if not a known function.
 */
function inferFunctionCallType(expression: string): 'string' | 'numeric' | 'void' | undefined {
  const match = expression.match(/^([A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*)\s*\(/);
  if (!match) return undefined;

  const funcName = match[1].toLowerCase();
  const sig = KNOWN_SIGNATURES.get(funcName);
  if (!sig) return undefined;

  return sig.returnType;
}

/**
 * Infer the type of a simple variable reference from the VariableTypeMap.
 */
function inferVariableType(
  expression: string,
  variableTypes: VariableTypeMap,
): VariableType | undefined {
  const trimmed = expression.trim();
  if (/^[A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*$/.test(trimmed)) {
    const info = variableTypes.get(trimmed.toLowerCase());
    return info?.type;
  }
  return undefined;
}
