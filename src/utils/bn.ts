const MAX_NUMBER = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_NUMBER = BigInt(Number.MIN_SAFE_INTEGER)
const ZERO = BigInt(0)

/**
 * Parses the given input using JS's native BigInt and returns a number or a string depending on the size of the number.
 * @param input "0x"-prefixed hex string, base 10 number string or number
 * @returns the value as number if it is safe to do so (given JS's number precision) - otherwise returns a string
 */
export function parseBigInt(input: number | string): number | string {
  if (input == null || input === '') {
    throw new Error('Cannot convert empty value to BigInt')
  }
  const n = BigInt(input)
  return n <= MAX_NUMBER && n >= MIN_NUMBER ? parseInt(n.toString(10), 10) : n.toString(10)
}

/**
 * Parses the given input using JS's native BigInt and returns a number.
 * If the value exeeds the safe bounds of integers in JS it will throw an error.
 * @param input "0x"-prefixed hex string, base 10 number string or number
 */
export function bigIntToNumber(input: number | string | BigInt): number {
  const n = BigInt(input as any)
  if (n > MAX_NUMBER || n < MIN_NUMBER) {
    throw new Error(`BigInt overflow for "${input}" - cannot convert to number`)
  }
  return parseInt(n.toString(10), 10)
}

/**
 * Returns hex representation of the given number if "0x" prefix
 */
export function numberToHex(input: number | string | BigInt): string {
  const n = BigInt(input as any)
  const hex = n.toString(16)
  return n < ZERO ? `-0x${hex.slice(1)}` : `0x${hex}`
}
