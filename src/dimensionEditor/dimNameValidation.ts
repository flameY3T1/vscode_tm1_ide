// src/dimensionEditor/dimNameValidation.ts
// Pure (vscode-free): name validation for new dimensions. Extracted from
// commands/dimension/createDimension.ts so that the Save-as handler in
// dimensionEditor can use it without an import cycle (createDimension ↔
// dimensionEditor).

const NAME_RE = /^[A-Za-z][A-Za-z0-9_ ]{0,254}$/;

export function validateDimName(raw: string, existingNames: string[]): string | undefined {
  const name = (raw ?? '').trim();
  if (!name) return 'Name must not be empty.';
  if (name.length > 255) return 'Name is too long (max. 255 characters).';
  if (!NAME_RE.test(name)) {
    return 'Name must start with a letter and may only contain letters, digits, underscore or spaces.';
  }
  const lower = name.toLowerCase();
  if (existingNames.some(n => n.toLowerCase() === lower)) {
    return `Dimension "${name}" already exists.`;
  }
  return undefined;
}
