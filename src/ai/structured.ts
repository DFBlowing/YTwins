/**
 * Reading a structured answer out of what a model actually said.
 *
 * Every operation on the port asks the model for a JSON object, because the
 * alternative — asking in prose and parsing prose — is a reading nobody can
 * check. But "asked for JSON" is not "got JSON": a model wraps its answer in a
 * fence, prefixes it with a sentence, drops a brace, or returns nothing at all
 * (which DeepSeek's own documentation warns can happen in JSON mode).
 *
 * So there are two jobs here, and both of them are about **not guessing**:
 *
 *  - find the object in what came back (a fence and a sentence around it are
 *    ordinary, so they are tolerated);
 *  - check every field it claims to have, by name, before anything downstream
 *    reads it.
 *
 * A failure is a `ProviderCallError` naming the call, the field and what was
 * actually there. Nothing is repaired and nothing is defaulted: a reading with
 * an invented field would be the product putting words in the user's mouth,
 * and a reading silently defaulted to "empty" would be the product claiming
 * the user said nothing.
 *
 * @module ai/structured
 */

import { INPUT_TYPES, type InputType } from '../domain/interface.ts';
import { ProviderCallError, shorten } from './errors.ts';

/** How a value reads in an error, without dumping an object nobody can use. */
function describe(value: unknown): string {
  if (value === undefined) return '（没有这个字段）';
  if (value === null) return 'null';
  const rendered = typeof value === 'string' ? value : JSON.stringify(value);
  return rendered === undefined ? String(value) : shorten(rendered);
}

/**
 * The object inside a model's answer, or a diagnosable failure.
 *
 * @param content - the message content, verbatim.
 * @param operation - the operation being asked, so the error names it.
 * @returns the parsed object.
 * @throws ProviderCallError when there is no object to be had.
 */
export function readJsonObject(content: string, operation: string): Record<string, unknown> {
  const text = content.trim();
  if (text.length === 0) {
    // Called out separately because it is a documented quirk of JSON mode
    // rather than a broken answer: retrying is the whole remedy, and a message
    // that made it look like a bug in this code would send someone hunting.
    throw new ProviderCallError(
      `模型在 ${operation} 里返回了空内容（JSON 模式偶有发生，重试即可）。`,
    );
  }

  const candidate = jsonCandidate(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new ProviderCallError(
      `模型在 ${operation} 里没有返回合法 JSON：${shorten(text)}`,
      { cause: error },
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProviderCallError(
      `模型在 ${operation} 里返回的不是一个 JSON 对象：${shorten(text)}`,
    );
  }

  return parsed as Record<string, unknown>;
}

/**
 * The part of an answer that could be the JSON object.
 *
 * A fence first, then the outermost braces. Both are tolerances with a reason:
 * models fence JSON constantly, and an answer with a sentence in front of it is
 * still an answer. What is *not* tolerated is inventing structure — when there
 * are no braces the whole text is handed to `JSON.parse` so that the failure
 * quotes what was really said.
 */
function jsonCandidate(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text);
  const body = fenced?.[1]?.trim() ?? text;

  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return body;
  return body.slice(start, end + 1);
}

/**
 * A JSON object, wherever one is expected inside an answer.
 *
 * @param value - the value that should be an object.
 * @param where - how to name its position, e.g. `items[0]`.
 * @param operation - the operation, for the error message.
 * @returns the object.
 */
export function requireObject(
  value: unknown,
  where: string,
  operation: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderCallError(
      `模型在 ${operation} 里给出的 ${where} 不是一个 JSON 对象：${describe(value)}`,
    );
  }
  return value as Record<string, unknown>;
}

/** One field, by name, refusing to read a value that is not there. */
function fieldOf(object: Record<string, unknown>, field: string, operation: string): unknown {
  const value = object[field];
  if (value === undefined) {
    throw new ProviderCallError(`模型在 ${operation} 里没有给出字段 ${field}。`);
  }
  return value;
}

/**
 * A non-empty string field.
 *
 * Blank is refused together with missing, because on this port a blank string
 * is what "I have nothing to say" looks like when it should have been a
 * sentence: the domain refuses those anyway, and refusing them here names the
 * field rather than the symptom.
 *
 * @param object - the parsed answer.
 * @param field - the field to read.
 * @param operation - the operation, for the error message.
 * @returns the trimmed string.
 */
export function requireString(
  object: Record<string, unknown>,
  field: string,
  operation: string,
): string {
  const value = fieldOf(object, field, operation);
  if (typeof value !== 'string') {
    throw new ProviderCallError(
      `模型在 ${operation} 里给出的 ${field} 不是一个字符串：${describe(value)}`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ProviderCallError(`模型在 ${operation} 里把 ${field} 写成了空字符串。`);
  }
  return trimmed;
}

/**
 * An optional string field: absent, null and blank all read as nothing.
 *
 * @param object - the parsed answer.
 * @param field - the field to read.
 * @param operation - the operation, for the error message.
 * @returns the trimmed string, or null.
 */
export function optionalString(
  object: Record<string, unknown>,
  field: string,
  operation: string,
): string | null {
  const value = object[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ProviderCallError(
      `模型在 ${operation} 里给出的 ${field} 既不是字符串也不是 null：${describe(value)}`,
    );
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A list of strings.
 *
 * The elements are checked, not cast: a list that is half numbers would
 * otherwise reach the domain as a list of strings and only fail much later, in
 * a place that cannot say which model call was at fault.
 *
 * @param object - the parsed answer.
 * @param field - the field to read.
 * @param operation - the operation, for the error message.
 * @returns the trimmed, non-empty entries, in the order the model gave them.
 */
export function requireStringArray(
  object: Record<string, unknown>,
  field: string,
  operation: string,
): string[] {
  const value = fieldOf(object, field, operation);
  if (!Array.isArray(value)) {
    throw new ProviderCallError(
      `模型在 ${operation} 里给出的 ${field} 不是一个数组：${describe(value)}`,
    );
  }
  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new ProviderCallError(
        `模型在 ${operation} 里给出的 ${field} 里有一个不是字符串的元素：${describe(entry)}`,
      );
    }
    return entry.trim();
  });
}

/**
 * A list, whatever is in it. The caller reads the entries itself.
 *
 * @param object - the parsed answer.
 * @param field - the field to read.
 * @param operation - the operation, for the error message.
 * @returns the array.
 */
export function requireArray(
  object: Record<string, unknown>,
  field: string,
  operation: string,
): unknown[] {
  const value = fieldOf(object, field, operation);
  if (!Array.isArray(value)) {
    throw new ProviderCallError(
      `模型在 ${operation} 里给出的 ${field} 不是一个数组：${describe(value)}`,
    );
  }
  return value;
}

/**
 * A boolean field.
 *
 * @param object - the parsed answer.
 * @param field - the field to read.
 * @param operation - the operation, for the error message.
 * @returns the boolean.
 */
export function requireBoolean(
  object: Record<string, unknown>,
  field: string,
  operation: string,
): boolean {
  const value = fieldOf(object, field, operation);
  if (typeof value !== 'boolean') {
    throw new ProviderCallError(
      `模型在 ${operation} 里给出的 ${field} 不是一个布尔值：${describe(value)}`,
    );
  }
  return value;
}

/**
 * One of the four input types.
 *
 * Refused rather than approximated when it is something else, and that is a
 * product decision rather than a strictness for its own sake: the input type is
 * what decides whether a drop is a **moment** the product speaks after
 * (`emotion`), so guessing one would either silence a moment that should have
 * happened or invent one that should not.
 *
 * @param object - the parsed answer.
 * @param field - the field to read.
 * @param operation - the operation, for the error message.
 * @returns the input type.
 */
export function requireInputType(
  object: Record<string, unknown>,
  field: string,
  operation: string,
): InputType {
  const value = fieldOf(object, field, operation);
  if (typeof value !== 'string') {
    throw new ProviderCallError(
      `模型在 ${operation} 里给出的 ${field} 不是一个输入类型：${describe(value)}`,
    );
  }
  const normalised = value.trim().toLowerCase();
  const known = INPUT_TYPES.find((candidate) => candidate === normalised);
  if (known === undefined) {
    throw new ProviderCallError(
      `模型在 ${operation} 里给出的 ${field} 是「${value.trim()}」，不在 ${INPUT_TYPES.join(' / ')} 里。`,
    );
  }
  return known;
}
