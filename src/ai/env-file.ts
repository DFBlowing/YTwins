/**
 * Reading a `.env` file into the process environment.
 *
 * The product's one secret — the cloud LLM's API key — lives in a file beside
 * the repository and never in it. This is the module that puts it into the
 * server's environment, so that exactly one process on exactly one machine can
 * read it, and so that nothing else has to know the file exists.
 *
 * Deliberately a few dozen lines rather than a dependency: the whole format is
 * "one NAME=VALUE per line", the alternative is a package that supports
 * expansion, multi-line values and interpolation — none of which this project
 * wants, because every one of them is a way for a value to be something other
 * than what a person reading the file would say it is.
 *
 * The rules, and they are the reason this file is tested:
 *
 *  - a line without `=` sets nothing, rather than setting a variable to itself;
 *  - `export NAME=VALUE` is read, because that is how many people write it;
 *  - surrounding quotes are not part of the value;
 *  - a `#` after the value starts a comment;
 *  - **the environment wins**. A variable that is already set is not
 *    overwritten, so `YTwins_LLM=local node src/web/server.ts` does what it
 *    looks like it does.
 *
 * @module ai/env-file
 */

import { readFile } from 'node:fs/promises';

/**
 * Read one `.env` file's text into a plain record.
 *
 * @param text - the file's contents, or any text in that shape.
 * @returns the pairs it sets, with nothing invented for the lines it cannot read.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const pairs: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separator = withoutExport.indexOf('=');
    if (separator <= 0) continue;

    const name = withoutExport.slice(0, separator).trim();
    if (name.length === 0) continue;
    pairs[name] = readValue(withoutExport.slice(separator + 1));
  }

  return pairs;
}

/**
 * The value part of one line, with the punctuation a person adds taken off.
 *
 * Quotes are honoured when they are the first non-blank character, and then
 * everything outside them is dropped: `KEY="a b" # note` is `a b`. Without
 * quotes, a `#` starts a comment. A `#` that is part of a value (a password,
 * say) has to be quoted, which is the one convention this format asks for.
 */
function readValue(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const closing = value.indexOf(quote, 1);
    if (closing !== -1) return value.slice(1, closing);
    return value.slice(1);
  }
  const comment = value.indexOf('#');
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}

/**
 * Load a `.env` file into an environment, without overriding what is already there.
 *
 * @param file - path of the file. A missing one is an ordinary state, not an error.
 * @param env - the environment to fill. Mutated in place, like `process.env`.
 * @returns whether a file was found and read.
 */
export async function loadEnvFile(
  file: string,
  env: Record<string, string | undefined>,
): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    // Nothing configured yet is the normal state of a fresh clone, so a missing
    // file is reported as "no file" rather than thrown. Anything else — a
    // permissions problem, a directory where a file should be — is a real
    // failure and is left to the caller: silently starting without the key
    // would look exactly like a key that does not work.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }

  for (const [name, value] of Object.entries(parseEnvFile(text))) {
    if (env[name] === undefined) env[name] = value;
  }
  return true;
}
