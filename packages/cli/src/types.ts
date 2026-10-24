/**
 * The boundary between the CLI's logic and the world outside it.
 */

/** What the shim needs in order to print and exit. */
export interface CliResult {
  readonly output: string;
  readonly exitCode: number;
}

/**
 * The filesystem, as the CLI sees it.
 *
 * Injecting it keeps `src/` free of Node globals: the only file that touches
 * `node:fs` is `bin/carto-a11y.js`, and tests pass an in-memory stand-in.
 * Implementations may throw; callers turn that into an error result.
 */
export interface CliIo {
  /** Read a UTF-8 text file. */
  readTextFile(path: string): string;
  /** Write a UTF-8 text file, creating or truncating it. */
  writeTextFile(path: string, contents: string): void;
}
