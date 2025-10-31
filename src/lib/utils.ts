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
      const header = sql.slice(0, firstNewline).trim();
      if (/^```(sql|postgresql|postgres)?$/i.test(header)) {
        sql = sql.slice(firstNewline + 1);
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

  return sql.trim();
}
