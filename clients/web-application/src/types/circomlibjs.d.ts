declare module 'circomlibjs' {
  export function buildPoseidon(): Promise<{
    (inputs: bigint[]): unknown
    F: { toString: (x: unknown) => string }
  }>
}
