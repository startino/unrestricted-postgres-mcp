import pg from "pg";

/**
 * Safely releases a client back to the pool, handling potential
 * "already released" errors gracefully
 */
export function safelyReleaseClient(client: pg.PoolClient): void {
  try {
    client.release();
  } catch (err) {
    console.error("Error releasing client (may already be released):", err);
  }
}

/**
 * Determine if a query is read-only (DQL)
 * @param sql The SQL query to analyze
 * @returns True if the query is read-only
 */
export function isReadOnlyQuery(sql: string): boolean {
  const normalizedSql = sql.trim().toUpperCase();
  return normalizedSql.startsWith("SELECT") || 
         normalizedSql.startsWith("WITH") || 
         normalizedSql.startsWith("EXPLAIN") || 
         (normalizedSql.startsWith("SHOW") && !normalizedSql.includes("CREATE"));
}

/**
 * Generate a unique transaction ID
 * @returns A unique transaction identifier
 */
export function generateTransactionId(): string {
  return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Ensure the session is clean before use by rolling back any open/aborted
 * transaction and discarding session state. Errors are ignored.
 */
export async function ensureCleanSession(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
  try {
    await client.query("DISCARD ALL");
  } catch {}
}

/**
 * Sanitize LLM-generated SQL by stripping common wrappers like code fences and triple quotes.
 * - Removes leading/trailing ```sql ... ``` or ``` ... ```
 * - Removes leading/trailing ''' or """
 * - Trims whitespace
 */
export function sanitizeSql(input: string): string {
  if (typeof input !== "string") return input as any;
  let sql = input.trim();

  // Strip markdown code fences ```sql ... ``` or ``` ... ```
  if (sql.startsWith("```")) {
    const firstNewline = sql.indexOf("\n");
    if (firstNewline !== -1) {
      // Multi-line code fence: ```sql\n...\n```
      const header = sql.slice(0, firstNewline).trim();
      if (/^```(sql|postgresql|postgres)?$/i.test(header)) {
        sql = sql.slice(firstNewline + 1);
      }
    } else {
      // Single-line code fence: ```...``` or ```sql...```
      const headerMatch = sql.match(/^```(sql|postgresql|postgres)?/i);
      if (headerMatch) {
        sql = sql.slice(headerMatch[0].length);
      }
    }
    if (sql.endsWith("```")) {
      sql = sql.slice(0, -3);
    }
    sql = sql.trim();
  }

  // Strip Python-style triple quotes '''...'''
  if (/^'''[\s\S]*'''$/.test(sql)) {
    sql = sql.slice(3, -3).trim();
  }

  // Strip Python-style triple double quotes """..."""
  if (/^"""[\s\S]*"""$/.test(sql)) {
    sql = sql.slice(3, -3).trim();
  }

  // Remove stray triple-quote-only lines at start/end
  sql = sql.replace(/^(?:'''+|"""+)\s*\n/, "");
  sql = sql.replace(/\n\s*(?:'''+|"""+)\s*$/, "");

  // If the entire payload is quoted as a single string, unwrap once
  const unwrapped = unwrapWholeString(sql);
  if (unwrapped !== null) {
    sql = unwrapped.trim();
  }

  // Context-aware normalization outside strings/identifiers/comments
  sql = normalizeSqlOutsideQuoted(sql);

  return sql.trim();
}

/** Unwraps a payload if entirely wrapped in a matching single or double quoted string. */
function unwrapWholeString(text: string): string | null {
  if (text.length < 2) return null;
  const first = text[0];
  const last = text[text.length - 1];
  if (!((first === '"' && last === '"') || (first === "'" && last === "'"))) return null;

  // Verify there is no unescaped closing quote within the body
  let i = 1;
  while (i < text.length - 1) {
    const ch = text[i];
    if (ch === last) {
      // Found an internal closing quote → not a whole-string wrapper
      return null;
    }
    // Handle escaped double quote within double quotes
    if (first === '"' && ch === '\\' && text[i + 1] === '"') { i += 2; continue; }
    // Handle doubled single quotes within single quotes
    if (first === "'" && ch === "'" && text[i + 1] === "'") { i += 2; continue; }
    i += 1;
  }
  return text.slice(1, -1);
}

/** Performs one normalization pass outside of quotes and comments. */
function normalizeSqlOutsideQuoted(text: string): string {
  const isZeroWidth = (code: number) => code === 0xfeff || code === 0x200b;

  let i = 0;
  const n = text.length;
  let out = "";
  type State = "outside" | "single" | "double" | "dollar" | "lineComment" | "blockComment";
  let state: State = "outside";
  let dollarTag: string | null = null;

  const peek = (k = 0) => (i + k < n ? text[i + k] : "");

  const matchDollarTag = (): string | null => {
    if (peek() !== '$') return null;
    let j = i + 1;
    while (/[A-Za-z0-9_]/.test(text[j] || '')) { j++; }
    if (text[j] === '$') {
      return text.slice(i, j + 1);
    }
    return null;
  };

  while (i < n) {
    const ch = peek();
    const nx = peek(1);

    if (state === "outside") {
      // Comments
      if (ch === '-' && nx === '-') { out += ch + nx; i += 2; state = "lineComment"; continue; }
      if (ch === '/' && nx === '*') { out += ch + nx; i += 2; state = "blockComment"; continue; }

      // Quotes
      if (ch === "'") { out += ch; i++; state = "single"; continue; }
      if (ch === '"') { out += ch; i++; state = "double"; continue; }
      if (ch === '$') {
        const tag = matchDollarTag();
        if (tag) { out += tag; i += tag.length; dollarTag = tag; state = "dollar"; continue; }
      }

      // Normalize CRLF → LF
      if (ch === '\r' && nx === '\n') { i += 1; continue; }

      // Drop zero-width characters (BOM, ZWSP)
      if (isZeroWidth(ch.codePointAt(0)!)) { i++; continue; }

      // Remove line-continuation backslash at end of line
      if (ch === '\\' && nx === '\n') { i += 1; continue; }

      // Decode one layer of common escapes outside quotes
      if (ch === '\\') {
        if (nx === 'n') { /* drop */ i += 2; continue; }
        if (nx === 'r') { /* drop */ i += 2; continue; }
        if (nx === 't') { /* drop */ i += 2; continue; }
        // Drop any other stray backslash outside quoted contexts
        i += 1; 
        continue;
      }

      // Convert lone newlines outside quotes/comments to single space
      if (ch === '\n') {
        if (out.length === 0 || !/\s/.test(out[out.length - 1])) {
          out += ' ';
        }
        i++;
        continue;
      }

      out += ch; i++; continue;
    }

    if (state === "single") {
      out += ch; i++;
      if (ch === "'") {
        if (peek() === "'") { out += peek(); i++; continue; }
        state = "outside";
      }
      continue;
    }

    if (state === "double") {
      out += ch; i++;
      if (ch === '"') { state = "outside"; }
      if (ch === '\\' && peek() === '"') { out += peek(); i++; }
      continue;
    }

    if (state === "dollar") {
      if (dollarTag && text.startsWith(dollarTag, i)) { out += dollarTag; i += dollarTag.length; state = "outside"; dollarTag = null; continue; }
      out += ch; i++; continue;
    }

    if (state === "lineComment") {
      if (ch === '\r' && nx === '\n') { i += 1; continue; }
      out += ch; i++;
      if (ch === '\n') { state = "outside"; }
      continue;
    }

    if (state === "blockComment") {
      if (ch === '\r' && nx === '\n') { i += 1; continue; }
      out += ch; i++;
      if (ch === '*' && peek() === '/') { out += peek(); i++; state = "outside"; }
      continue;
    }
  }

  return out;
}
