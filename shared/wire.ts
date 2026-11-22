/**
 * The shape a server value has once it is sent as JSON: chip amounts
 * (bigint on the server) arrive as plain numbers of chips, and dates as ISO
 * strings. The browser types API responses and live events with it.
 *
 *   type RoundView = Wire<SettledRound>
 */
export type Wire<T> = T extends bigint
  ? number
  : T extends Date
    ? string
    : T extends readonly (infer U)[]
      ? Wire<U>[]
      : T extends (...args: never[]) => unknown
        ? never
        : T extends object
          ? { [K in keyof T]: Wire<T[K]> }
          : T
