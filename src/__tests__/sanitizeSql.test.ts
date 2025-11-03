import { describe, it, expect } from 'vitest';
import { sanitizeSql } from '#lib/utils';

describe('sanitizeSql', () => {
  it('removes code fences and triple quotes', () => {
    const input = "```sql\nSELECT 1;\\n\n```";
    expect(sanitizeSql(input)).toBe('SELECT 1;');
    const t1 = "'''\nSELECT 1;\n'''";
    expect(sanitizeSql(t1)).toBe('SELECT 1;');
    const t2 = '"""\nSELECT 1;\n"""';
    expect(sanitizeSql(t2)).toBe('SELECT 1;');
  });

  it('unwraps whole-string JSON-like payloads once', () => {
    const input = '"SELECT 1;\\n"';
    expect(sanitizeSql(input)).toBe('SELECT 1;');
  });

  it('drops escaped newline/tab/carriage returns outside quotes', () => {
    const input = 'SELECT 1;\\n\\t\\r';
    expect(sanitizeSql(input)).toBe('SELECT 1;');
  });

  it('converts outside newlines to a single space', () => {
    const input = 'SELECT 1\n+ 2;';
    expect(sanitizeSql(input)).toBe('SELECT 1 + 2;');
  });

  it('removes line-continuation backslash before newline', () => {
    const input = 'SELECT 1 \\\n+  + 2;';
    expect(sanitizeSql(input).replace(/\s{2,}/g, ' ').trim()).toBe('SELECT 1 + + 2;');
  });

  it('preserves content inside single-quoted strings', () => {
    const input = "SELECT 'a\\n b' AS t;";
    expect(sanitizeSql(input)).toBe("SELECT 'a\\n b' AS t;");
  });

  it('preserves content inside double-quoted identifiers', () => {
    const input = 'SELECT "a\\n b" FROM t;';
    expect(sanitizeSql(input)).toBe('SELECT "a\\n b" FROM t;');
  });

  it('preserves content inside dollar-quoted bodies', () => {
    const input = "DO $x$BEGIN RAISE NOTICE 'x\\n'; END;$x$;";
    expect(sanitizeSql(input)).toBe("DO $x$BEGIN RAISE NOTICE 'x\\n'; END;$x$;");
  });

  it('is idempotent', () => {
    const once = sanitizeSql('```sql\nSELECT 1;\\n\n```');
    const twice = sanitizeSql(once);
    expect(twice).toBe('SELECT 1;');
  });

  it('handles CRLF inputs safely', () => {
    const input = 'SELECT 1;\r\n';
    expect(sanitizeSql(input)).toBe('SELECT 1;');
  });
});


