export function columnName(column: number): string {
  if (!Number.isSafeInteger(column) || column < 1 || column > 18278) throw new Error('Column must be between 1 and 18278');
  let result = '';
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + (value - 1) % 26) + result;
  }
  return result;
}
