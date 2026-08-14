// Lives in `src/application/`, not `src/domain/`: the function itself is
// pure, but its callers feed it I/O-adjacent inputs — a wall-clock instant
// (message receipt time) and a user row's `timezone` column
// (04-RESEARCH.md's Architectural Responsibility Map).
//
// D-07: this value is computed ONCE, at message receipt, and every later
// step (confirmation, editing a saved diary entry) copies that stored value
// rather than recomputing it — recomputing later would let a correction made
// after local midnight silently move a meal to the wrong day.

/**
 * Converts an instant plus an IANA timezone into the Postgres-ready
 * `YYYY-MM-DD` calendar day string for `diary.local_date`.
 */
export function deriveLocalDate(instant: Date, timezone: string): string {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid local-date input: instant must be a valid Date (got ${String(instant)}).`);
  }

  try {
    // The 'en-CA' locale emits YYYY-MM-DD directly, which is exactly what
    // Postgres's `date` column accepts — no manual string reassembly, no
    // offset table, no new npm package. Node's bundled ICU carries the IANA
    // database including DST and historical-offset rules.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch (error) {
    // Intl.DateTimeFormat throws a RangeError on an unknown IANA zone. Never
    // fall back to the process's local timezone — that would silently file
    // a meal under the server's day instead of the user's (the exact class
    // of bug D-07 exists to prevent).
    throw new Error(
      `Invalid local-date input: unknown IANA timezone "${timezone}" (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}
