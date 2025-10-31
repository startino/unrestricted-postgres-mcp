import pg from "pg";
import { TransactionManager } from "./transaction-manager";
import {
  isReadOnlyQuery,
  safelyReleaseClient,
  generateTransactionId,
  sanitizeSql,
  ensureCleanSession,
} from "./utils";
import { SCHEMA_PATH } from "./types";

export async function handleExecuteRollback(
  transactionManager: TransactionManager,
  transactionId: string,
) {
  if (!transactionId) {
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          status: "error",
          message: "Missing required parameter: transaction_id",
          details: "The rollback_transaction tool requires a 'transaction_id' parameter to identify which transaction to rollback",
          expected_format: { transaction_id: "txn_12345" },
          received: { transaction_id: transactionId || null }
        }, null, 2)
      }],
      isError: true,
    };
  }

  // Check if transaction exists
  if (!transactionManager.hasTransaction(transactionId)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "error",
              message: "Transaction not found",
              details: `No active transaction found with ID: ${transactionId}`,
              transaction_id: transactionId,
              suggestion: "Use list_transactions to see all active transactions, or the transaction may have already been committed/rolled back"
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  // Get the transaction data
  const transaction = transactionManager.getTransaction(transactionId)!;

  // Check if already released
  if (transaction.released) {
    transactionManager.removeTransaction(transactionId);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "error",
              message: "Transaction already released",
              details: `Transaction ${transactionId} has already been released and cannot be rolled back`,
              transaction_id: transactionId,
              suggestion: "This transaction was already committed or rolled back. Use list_transactions to see current active transactions"
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  try {
    // Rollback the transaction
    await transaction.client.query("ROLLBACK");

    // Mark as released before actually releasing
    transaction.released = true;
    safelyReleaseClient(transaction.client);

    // Clean up
    transactionManager.removeTransaction(transactionId);

    return {
      content: [
        {
          type: "text",
          text:
            JSON.stringify(
              {
                status: "rolled_back",
                message: "Transaction successfully rolled back",
                transaction_id: transactionId,
              },
              null,
              2,
            ) +
            "\n\nTransaction has been successfully rolled back. No changes have been made to the database.",
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    // If there's an error during rollback
    // Mark as released before actually releasing
    transaction.released = true;
    safelyReleaseClient(transaction.client);

    // Clean up
    transactionManager.removeTransaction(transactionId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "error",
              message: "Transaction rollback failed",
              details: error.message,
              transaction_id: transactionId,
              error_type: error.code || "ROLLBACK_ERROR",
              suggestion: "The transaction may have been automatically rolled back due to an error. Check the database state."
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}

export async function handleExecuteQuery(pool: pg.Pool, sql: string) {
  const client = await pool.connect();
  try {
    // Clear any inherited aborted state before starting
    await ensureCleanSession(client);
    if (!sql) {
      safelyReleaseClient(client);
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "error",
            message: "Missing required parameter: sql",
            details: "The execute_query tool requires a 'sql' parameter containing the SELECT query to execute",
            expected_format: { sql: "SELECT * FROM table_name WHERE condition" },
            received: { sql: sql || null }
          }, null, 2)
        }],
        isError: true,
      };
    }

    // Sanitize common LLM wrappers
    sql = sanitizeSql(sql);

    // Validate that the query is read-only
    if (!isReadOnlyQuery(sql)) {
      safelyReleaseClient(client);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: "Invalid query type for execute_query tool",
              details: "The execute_query tool only accepts SELECT statements for safety. Other operations should use execute_dml_ddl_dcl_tcl.",
              received_query: sql.trim().substring(0, 100) + (sql.length > 100 ? "..." : ""),
              suggestion: "Use execute_dml_ddl_dcl_tcl for INSERT, UPDATE, DELETE, CREATE, ALTER, DROP operations"
            }, null, 2)
          },
        ],
        isError: true,
      };
    }

    // Execute the query in a read-only transaction
    await client.query("BEGIN TRANSACTION READ ONLY");
    let result;
    const startTime = Date.now();
    try {
      result = await client.query(sql);
      await client.query("COMMIT");
    } catch (err: any) {
      try { await client.query("ROLLBACK"); } catch {}
      // Auto-recover once if aborted
      if (String(err?.message || "").includes("current transaction is aborted")) {
        await ensureCleanSession(client);
        await client.query("BEGIN TRANSACTION READ ONLY");
        result = await client.query(sql);
        await client.query("COMMIT");
      } else {
        throw err;
      }
    }
    const execTime = Date.now() - startTime;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              rows: result.rows,
              rowCount: result.rowCount,
              fields: result.fields.map((f) => ({
                name: f.name,
                dataTypeID: f.dataTypeID,
              })),
              execution_time_ms: execTime,
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  } finally {
    safelyReleaseClient(client);
  }
}

export async function handleExecuteDML(
  pool: pg.Pool,
  sql: string,
  params?: any[]
) {
  const client = await pool.connect();
  try {
    // Clear any inherited aborted state before starting
    await ensureCleanSession(client);
    if (!sql) {
      safelyReleaseClient(client);
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "error",
            message: "Missing required parameter: sql",
            details: "The execute_dml_ddl_dcl_tcl tool requires a 'sql' parameter containing the SQL statement(s) to execute",
            expected_format: { sql: "INSERT INTO table_name VALUES (...); UPDATE table_name SET ..." },
            received: { sql: sql || null }
          }, null, 2)
        }],
        isError: true,
      };
    }

    // Sanitize common LLM wrappers
    sql = sanitizeSql(sql);

    // Begin a transaction
    await client.query("BEGIN");

    try {
      // Execute the SQL statement(s)
      const startTime = Date.now();
      let result;
      try {
        result = await client.query(sql, Array.isArray(params) ? params : []);
        await client.query("COMMIT");
      } catch (err: any) {
        try { await client.query("ROLLBACK"); } catch {}
        // Auto-recover once if aborted
        if (String(err?.message || "").includes("current transaction is aborted")) {
          await ensureCleanSession(client);
          await client.query("BEGIN");
          result = await client.query(sql, Array.isArray(params) ? params : []);
          await client.query("COMMIT");
        } else {
          throw err;
        }
      }
      const execTime = Date.now() - startTime;

      // Release the client
      safelyReleaseClient(client);

      // Count statements for better feedback
      const statementCount = sql.split(';').filter(stmt => stmt.trim().length > 0).length;
      
      // Return success result
      const resultObj = {
        status: "success",
        message: `SQL executed and committed successfully (${statementCount} statement${statementCount > 1 ? 's' : ''})`,
        result: {
          command: result.command,
          rowCount: result.rowCount,
          execution_time_ms: execTime,
          statements_executed: statementCount,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(resultObj, null, 2),
          },
        ],
        isError: false,
      };
    } catch (error: any) {
      // If there's an error, roll back and release the client
      await client.query("ROLLBACK");
      safelyReleaseClient(client);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "error",
                message: "SQL execution failed",
                details: error.message,
                sql_preview: sql.trim().substring(0, 200) + (sql.length > 200 ? "..." : ""),
                params_provided: Array.isArray(params) ? params.length : 0,
                error_type: error.code || "SQL_ERROR",
                suggestion: "Check your SQL syntax and ensure all referenced tables/columns exist"
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  } catch (error: any) {
    // If there's an error starting the transaction
    safelyReleaseClient(client);
    throw error;
  }
}

export async function handleExecuteMaintenance(pool: pg.Pool, sql: string) {
  const client = await pool.connect();
  try {
    if (!sql) {
      safelyReleaseClient(client);
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "error",
            message: "Missing required parameter: sql",
            details: "The execute_maintenance tool requires a 'sql' parameter containing the maintenance command",
            expected_format: { sql: "VACUUM table_name;" },
            allowed_commands: ["VACUUM", "ANALYZE", "CREATE DATABASE"],
            received: { sql: sql || null }
          }, null, 2)
        }],
        isError: true,
      };
    }

    // Sanitize common LLM wrappers
    sql = sanitizeSql(sql);

    // Check if the SQL is a maintenance command
    // VACUUM, ANALYZE, CREATE DATABASE can't be executed in a transaction
    const isMaintenanceCommand = /^(VACUUM|ANALYZE|CREATE DATABASE)/i.test(
      sql.trim(),
    );
    if (!isMaintenanceCommand) {
      safelyReleaseClient(client);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: "Invalid command for execute_maintenance tool",
              details: "Only VACUUM, ANALYZE, and CREATE DATABASE commands are allowed in maintenance mode",
              received_command: sql.trim().substring(0, 50) + (sql.length > 50 ? "..." : ""),
              allowed_commands: ["VACUUM", "ANALYZE", "CREATE DATABASE"],
              suggestion: "Use execute_dml_ddl_dcl_tcl for other SQL operations"
            }, null, 2)
          },
        ],
        isError: true,
      };
    }

    const startTime = Date.now();
    const result = await client.query(sql);
    const execTime = Date.now() - startTime;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "completed",
              command: result.command,
              execution_time_ms: execTime,
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "error",
              message: "Maintenance command execution failed",
              details: error.message,
              command_preview: sql.trim().substring(0, 100) + (sql.length > 100 ? "..." : ""),
              error_type: error.code || "MAINTENANCE_ERROR",
              suggestion: "Check command syntax and ensure you have the necessary privileges"
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  } finally {
    safelyReleaseClient(client);
  }
}


export async function handleListTables(
  pool: pg.Pool,
  schemaName: string = "public",
) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        t.table_name, 
        pg_catalog.obj_description(pgc.oid, 'pg_class') as table_description,
        (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) as column_count
      FROM 
        information_schema.tables t
      JOIN 
        pg_catalog.pg_class pgc ON t.table_name = pgc.relname
      WHERE 
        t.table_schema = $1
        AND t.table_type = 'BASE TABLE'
      ORDER BY 
        t.table_name
    `, [schemaName]);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.rows, null, 2),
        },
      ],
      isError: false,
    };
  } finally {
    safelyReleaseClient(client);
  }
}

export async function handleDescribeTable(
  pool: pg.Pool,
  tableName: string,
  schemaName: string = "public",
) {
  if (!tableName) {
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          status: "error",
          message: "Missing required parameter: table_name",
          details: "The describe_table tool requires a 'table_name' parameter to describe the table structure",
          expected_format: { table_name: "users", schema_name: "public" },
          received: { table_name: tableName || null, schema_name: schemaName || "public" }
        }, null, 2)
      }],
      isError: true,
    };
  }

  const client = await pool.connect();
  try {
    // Get column information
    const columnsResult = await client.query(`
      SELECT 
        column_name, 
        data_type, 
        character_maximum_length,
        column_default,
        is_nullable,
        col_description(pg_class.oid, columns.ordinal_position) as column_description
      FROM 
        information_schema.columns
      JOIN 
        pg_class ON pg_class.relname = columns.table_name
      WHERE 
        columns.table_name = $1
        AND columns.table_schema = $2
      ORDER BY 
        ordinal_position
    `, [tableName, schemaName]);

    // Get primary key information
    const pkResult = await client.query(`
      SELECT 
        a.attname as column_name
      FROM 
        pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE 
        i.indrelid = $1::regclass
        AND i.indisprimary
    `, [`${schemaName}.${tableName}`]);

    // Get foreign key information
    const fkResult = await client.query(`
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM
        information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1 AND tc.table_schema = $2
    `, [tableName, schemaName]);

    // Get table description
    const tableDescResult = await client.query(`
      SELECT pg_catalog.obj_description(pgc.oid, 'pg_class') as table_description
      FROM pg_catalog.pg_class pgc
      WHERE pgc.relname = $1 AND pgc.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)
    `, [tableName, schemaName]);

    // Get approximate row count
    const rowCountResult = await client.query(`
      SELECT reltuples::bigint AS approximate_row_count
      FROM pg_class
      WHERE relname = $1 AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)
    `, [tableName, schemaName]);

    // Get indexes
    const indexesResult = await client.query(`
      SELECT
        i.relname AS index_name,
        am.amname AS index_type,
        array_agg(a.attname) AS column_names,
        ix.indisunique AS is_unique
      FROM
        pg_class t,
        pg_class i,
        pg_index ix,
        pg_attribute a,
        pg_am am
      WHERE
        t.oid = ix.indrelid
        AND i.oid = ix.indexrelid
        AND a.attrelid = t.oid
        AND a.attnum = ANY(ix.indkey)
        AND i.relam = am.oid
        AND t.relkind = 'r'
        AND t.relname = $1 AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)
      GROUP BY
        i.relname,
        am.amname,
        ix.indisunique
      ORDER BY
        i.relname
    `, [tableName, schemaName]);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              schema_name: schemaName,
              table_name: tableName,
              description: tableDescResult.rows[0]?.table_description || null,
              approximate_row_count:
                rowCountResult.rows[0]?.approximate_row_count || 0,
              columns: columnsResult.rows,
              primary_keys: pkResult.rows.map((row) => row.column_name),
              foreign_keys: fkResult.rows,
              indexes: indexesResult.rows,
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  } finally {
    safelyReleaseClient(client);
  }
}

export async function handleListResources(pool: pg.Pool, resourceBaseUrl: URL) {
  const client = await pool.connect();
  try {
    // Get all tables from the current schema (based on search_path)
    const result = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()",
    );

    return {
      resources: result.rows.map((row) => ({
        uri: new URL(`${row.table_name}/${SCHEMA_PATH}`, resourceBaseUrl).href,
        mimeType: "application/json",
        name: `"${row.table_name}" database schema`,
      })),
    };
  } finally {
    safelyReleaseClient(client);
  }
}

export async function handleReadResource(pool: pg.Pool, resourceUri: string) {
  const resourceUrl = new URL(resourceUri);
  const pathComponents = resourceUrl.pathname.split("/");
  const schema = pathComponents.pop();
  const tableName = pathComponents.pop();

  if (schema !== SCHEMA_PATH) {
    throw new Error("Invalid resource URI");
  }

  const client = await pool.connect();
  try {
    // Get column information for the requested table
    const columnsResult = await client.query(
      `SELECT 
        column_name, 
        data_type, 
        character_maximum_length,
        column_default,
        is_nullable
      FROM 
        information_schema.columns 
      WHERE 
        table_name = $1 AND table_schema = current_schema()
      ORDER BY 
        ordinal_position`,
      [tableName],
    );

    // Get primary key information
    const pkResult = await client.query(
      `
      SELECT 
        a.attname as column_name
      FROM 
        pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE 
        i.indrelid = $1::regclass
        AND i.indisprimary
    `,
      [`${tableName}`],
    );

    const primaryKeys = pkResult.rows.map((row) => row.column_name);

    // Format the column information with additional details
    const formattedColumns = columnsResult.rows.map((column) => {
      return {
        column_name: column.column_name,
        data_type: column.data_type,
        max_length: column.character_maximum_length,
        default_value: column.column_default,
        nullable: column.is_nullable === "YES",
        is_primary_key: primaryKeys.includes(column.column_name),
      };
    });

    // Return the enhanced schema information
    return {
      contents: [
        {
          uri: resourceUri,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              table_name: tableName,
              columns: formattedColumns,
              primary_keys: primaryKeys,
            },
            null,
            2,
          ),
        },
      ],
    };
  } finally {
    safelyReleaseClient(client);
  }
}

export async function handleListTransactions(
  transactionManager: TransactionManager,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}> {
  try {
    const transactions = transactionManager.getAllTransactions();

    if (transactions.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "success",
                message: "No active transactions",
                transaction_count: 0,
                transactions: [],
              },
              null,
              2,
            ),
          },
        ],
        isError: false,
      };
    }

    const transactionList = transactions.map((tx) => ({
      id: tx.id,
      start_time: new Date(tx.startTime).toISOString(),
      duration_ms: Date.now() - tx.startTime,
      state: tx.state,
      released: tx.released,
      sql_preview: tx.sql,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "success",
              message: `Found ${transactions.length} active transaction(s)`,
              transaction_count: transactions.length,
              transactions: transactionList,
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}

export async function handleForceRollback(pool: pg.Pool): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}> {
  const client = await pool.connect();
  try {
    // Force rollback any aborted transaction
    await client.query("ROLLBACK");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "success",
              message: "Successfully rolled back any aborted transactions",
              action: "force_rollback",
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "error",
              message: `Error during force rollback: ${error instanceof Error ? error.message : String(error)}`,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  } finally {
    safelyReleaseClient(client);
  }
}

export async function handleResetSession(pool: pg.Pool): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}> {
  const client = await pool.connect();
  try {
    // Try to rollback first
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // Ignore rollback errors - we're resetting anyway
    }

    // Reset the session to clear any transaction state
    await client.query("DISCARD ALL");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "success",
              message:
                "Database session reset successfully - all transaction state cleared",
              action: "reset_session",
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "error",
              message: `Error during session reset: ${error instanceof Error ? error.message : String(error)}`,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  } finally {
    safelyReleaseClient(client);
  }
}

export async function handleGetDatabaseSchema(pool: pg.Pool, schemaName: string = "public") {
  const client = await pool.connect();
  try {
    // Get all tables with their columns, types, and constraints
    const tablesQuery = `
      SELECT 
        t.table_name,
        t.table_type,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        c.ordinal_position,
        tc.constraint_name,
        tc.constraint_type
      FROM information_schema.tables t
      LEFT JOIN information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      LEFT JOIN information_schema.table_constraints tc ON t.table_name = tc.table_name AND t.table_schema = tc.table_schema
      WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name, c.ordinal_position, tc.constraint_name;
    `;

    const tablesResult = await client.query(tablesQuery, [schemaName]);

    // Get indexes separately - wrap in try-catch in case of permission issues
    let indexesResult;
    try {
      const indexesQuery = `
        SELECT 
          schemaname,
          tablename,
          indexname,
          indexdef
        FROM pg_indexes
        WHERE schemaname = $1
        ORDER BY tablename, indexname;
      `;
      indexesResult = await client.query(indexesQuery, [schemaName]);
    } catch (indexError: any) {
      console.error("Failed to fetch indexes:", indexError.message);
      indexesResult = { rows: [] };
    }

    // Get foreign key relationships using PostgreSQL system tables
    const foreignKeysQuery = `
      SELECT 
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        tc.constraint_name
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_schema = $1
      ORDER BY tc.table_name, kcu.column_name;
    `;

    const foreignKeysResult = await client.query(foreignKeysQuery, [schemaName]);

    // Get views
    const viewsQuery = `
      SELECT 
        table_name,
        view_definition
      FROM information_schema.views
      WHERE table_schema = $1
      ORDER BY table_name;
    `;

    const viewsResult = await client.query(viewsQuery, [schemaName]);

    // Get functions
    const functionsQuery = `
      SELECT 
        routine_name,
        routine_type,
        data_type,
        routine_definition
      FROM information_schema.routines
      WHERE routine_schema = $1
      ORDER BY routine_name;
    `;

    const functionsResult = await client.query(functionsQuery, [schemaName]);

    // Get table statistics - wrap in try-catch in case of permission issues
    let statsResult;
    try {
      const statsQuery = `
        SELECT 
          schemaname,
          tablename,
          COALESCE(n_tup_ins, 0) as inserts,
          COALESCE(n_tup_upd, 0) as updates,
          COALESCE(n_tup_del, 0) as deletes,
          COALESCE(n_live_tup, 0) as live_tuples,
          COALESCE(n_dead_tup, 0) as dead_tuples,
          last_vacuum,
          last_autovacuum,
          last_analyze,
          last_autoanalyze
        FROM pg_stat_user_tables
        WHERE schemaname = $1
        ORDER BY tablename;
      `;
      statsResult = await client.query(statsQuery, [schemaName]);
    } catch (statsError: any) {
      console.error("Failed to fetch statistics:", statsError.message);
      statsResult = { rows: [] };
    }

    // Organize the data
    const tables: any = {};
    const views: any = {};
    const functions: any = {};
    const statistics: any = {};

    // Process tables
    tablesResult.rows.forEach((row: any) => {
      if (!tables[row.table_name]) {
        tables[row.table_name] = {
          table_name: row.table_name,
          table_type: row.table_type,
          columns: {},
          constraints: [],
          indexes: []
        };
      }

      if (row.column_name) {
        tables[row.table_name].columns[row.column_name] = {
          column_name: row.column_name,
          data_type: row.data_type,
          is_nullable: row.is_nullable === 'YES',
          column_default: row.column_default,
          character_maximum_length: row.character_maximum_length,
          numeric_precision: row.numeric_precision,
          numeric_scale: row.numeric_scale,
          ordinal_position: row.ordinal_position
        };
      }

      if (row.constraint_name && !tables[row.table_name].constraints.find((c: any) => c.constraint_name === row.constraint_name)) {
        tables[row.table_name].constraints.push({
          constraint_name: row.constraint_name,
          constraint_type: row.constraint_type
        });
      }
    });

    // Process indexes separately
    indexesResult.rows.forEach((row: any) => {
      if (tables[row.tablename]) {
        if (!tables[row.tablename].indexes.find((i: any) => i.indexname === row.indexname)) {
          tables[row.tablename].indexes.push({
            indexname: row.indexname,
            indexdef: row.indexdef
          });
        }
      }
    });

    // Process foreign keys
    foreignKeysResult.rows.forEach((row: any) => {
      if (tables[row.table_name]) {
        // Find the constraint and add foreign key info
        const constraint = tables[row.table_name].constraints.find((c: any) => c.constraint_name === row.constraint_name);
        if (constraint) {
          constraint.referenced_table = row.foreign_table_name;
          constraint.referenced_column = row.foreign_column_name;
        }
      }
    });

    // Process views
    viewsResult.rows.forEach((row: any) => {
      views[row.table_name] = {
        table_name: row.table_name,
        view_definition: row.view_definition
      };
    });

    // Process functions
    functionsResult.rows.forEach((row: any) => {
      functions[row.routine_name] = {
        routine_name: row.routine_name,
        routine_type: row.routine_type,
        data_type: row.data_type,
        routine_definition: row.routine_definition
      };
    });

    // Process statistics
    statsResult.rows.forEach((row: any) => {
      statistics[row.tablename] = {
        inserts: row.inserts,
        updates: row.updates,
        deletes: row.deletes,
        live_tuples: row.live_tuples,
        dead_tuples: row.dead_tuples,
        last_vacuum: row.last_vacuum,
        last_autovacuum: row.last_autovacuum,
        last_analyze: row.last_analyze,
        last_autoanalyze: row.last_autoanalyze
      };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            message: "Database schema retrieved successfully",
            result: {
              tables,
              views,
              functions,
              statistics
            }
          }, null, 2)
        }
      ]
    };

  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "error",
            message: "Database schema retrieval failed",
            details: error.message,
            error_type: error.code || "SCHEMA_ERROR",
            suggestion: "Check database connection and ensure you have access to information_schema tables"
          }, null, 2)
        }
      ],
      isError: true
    };
  } finally {
    safelyReleaseClient(client);
  }
}

export async function handleSearchText(
  pool: pg.Pool,
  searchTerm: string,
  tables?: string[],
  columns?: string[],
  limit: number = 5,
  schemaName: string = "public"
) {
  const client = await pool.connect();
  try {
    if (!searchTerm || searchTerm.trim().length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: "Missing required parameter: search_term",
              details: "The search_text tool requires a 'search_term' parameter to search for text in database columns",
              expected_format: { search_term: "search phrase", tables: ["table1", "table2"], columns: ["col1", "col2"], limit: 100 },
              received: { search_term: searchTerm || null, tables: tables || null, columns: columns || null, limit: limit || 100 }
            }, null, 2)
          }
        ],
        isError: true
      };
    }

    // Get all text columns from specified tables or all tables
    let tablesQuery = `
      SELECT 
        t.table_name,
        c.column_name,
        c.data_type
      FROM information_schema.tables t
      JOIN information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE t.table_schema = $1 
        AND t.table_type = 'BASE TABLE'
        AND c.data_type IN ('text', 'character varying', 'character', 'varchar', 'char')
    `;

    if (tables && tables.length > 0) {
      const placeholders = tables.map((_, i) => `$${i + 2}`).join(',');
      tablesQuery += ` AND t.table_name IN (${placeholders})`;
    }

    if (columns && columns.length > 0) {
      const startIndex = 2 + (tables ? tables.length : 0);
      const placeholders = columns.map((_, i) => `$${startIndex + i}`).join(',');
      tablesQuery += ` AND c.column_name IN (${placeholders})`;
    }

    tablesQuery += ` ORDER BY t.table_name, c.column_name`;

    // Build parameters array
    const queryParams: any[] = [schemaName];
    if (tables && tables.length > 0) {
      queryParams.push(...tables);
    }
    if (columns && columns.length > 0) {
      queryParams.push(...columns);
    }

    const tablesResult = await client.query(tablesQuery, queryParams);

    if (tablesResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "success",
              message: "No text columns found to search",
              result: {
                search_term: searchTerm,
                results: []
              }
            }, null, 2)
          }
        ]
      };
    }

    // Build search queries for each table/column combination
    const searchQueries = [];
    const results: any[] = [];

    for (const row of tablesResult.rows) {
      const tableName = row.table_name;
      const columnName = row.column_name;
      
      // Validate table and column names to prevent SQL injection
      const validTableName = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName) ? tableName : null;
      const validColumnName = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(columnName) ? columnName : null;
      const validSchemaName = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName) ? schemaName : null;
      
      if (!validTableName || !validColumnName || !validSchemaName) {
        continue; // Skip invalid table/column names
      }

      // Use PostgreSQL's full-text search with ranking
      const searchQuery = `
        SELECT 
          $2 as table_name,
          $3 as column_name,
          ${validColumnName} as column_value,
          ts_rank(to_tsvector('english', ${validColumnName}), plainto_tsquery('english', $1)) as rank,
          ts_headline('english', ${validColumnName}, plainto_tsquery('english', $1), 'MaxWords=50, MinWords=10') as headline
        FROM ${validSchemaName}.${validTableName}
        WHERE to_tsvector('english', ${validColumnName}) @@ plainto_tsquery('english', $1)
        ORDER BY rank DESC
        LIMIT $4
      `;

      try {
        const searchResult = await client.query(searchQuery, [searchTerm, validTableName, validColumnName, limit]);
        results.push(...searchResult.rows);
      } catch (error: any) {
        // If full-text search fails, fall back to ILIKE
        const fallbackQuery = `
          SELECT 
            $2 as table_name,
            $3 as column_name,
            ${validColumnName} as column_value,
            1.0 as rank,
            ${validColumnName} as headline
          FROM ${validSchemaName}.${validTableName}
          WHERE ${validColumnName} ILIKE $1
          LIMIT $4
        `;

        try {
          const fallbackResult = await client.query(fallbackQuery, [`%${searchTerm}%`, validTableName, validColumnName, limit]);
          results.push(...fallbackResult.rows);
        } catch (fallbackError: any) {
          // Skip this column if both queries fail
          continue;
        }
      }
    }

    // Sort results by rank and limit
    results.sort((a, b) => (b.rank || 0) - (a.rank || 0));
    const limitedResults = results.slice(0, limit);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            message: `Found ${limitedResults.length} results for "${searchTerm}"`,
            result: {
              search_term: searchTerm,
              total_results: limitedResults.length,
              results: limitedResults
            }
          }, null, 2)
        }
      ]
    };

  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "error",
            message: "Text search failed",
            details: error.message,
            search_parameters: {
              search_term: searchTerm,
              tables: tables || "all tables",
              columns: columns || "all text columns",
              limit: limit
            },
            error_type: error.code || "SEARCH_ERROR",
            suggestion: "Check if the specified tables/columns exist and contain text data"
          }, null, 2)
        }
      ],
      isError: true
    };
  } finally {
    safelyReleaseClient(client);
  }
}