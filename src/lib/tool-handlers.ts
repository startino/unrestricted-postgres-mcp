import pg from "pg";
import { TransactionManager } from "./transaction-manager";
import {
  isReadOnlyQuery,
  safelyReleaseClient,
  generateTransactionId,
} from "./utils";
import { SCHEMA_PATH } from "./types";

export async function handleExecuteRollback(
  transactionManager: TransactionManager,
  transactionId: string,
) {
  if (!transactionId) {
    return {
      content: [{ type: "text", text: "Error: No transaction ID provided" }],
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
              message: "Transaction not found or already rolled back",
              transaction_id: transactionId,
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
              message: "Transaction client already released",
              transaction_id: transactionId,
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
              message: `Error rolling back transaction: ${error.message}`,
              transaction_id: transactionId,
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
    if (!sql) {
      safelyReleaseClient(client);
      return {
        content: [{ type: "text", text: "Error: No SQL query provided" }],
        isError: true,
      };
    }

    // Validate that the query is read-only
    if (!isReadOnlyQuery(sql)) {
      safelyReleaseClient(client);
      return {
        content: [
          {
            type: "text",
            text: "Error: Only SELECT queries are allowed with execute_query. For other operations, use execute_dml_ddl_dcl_tcl.",
          },
        ],
        isError: true,
      };
    }

    // Execute the query in a read-only transaction
    await client.query("BEGIN TRANSACTION READ ONLY");
    const startTime = Date.now();
    const result = await client.query(sql);
    const execTime = Date.now() - startTime;

    await client.query("COMMIT");

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
) {
  const client = await pool.connect();
  try {
    if (!sql) {
      safelyReleaseClient(client);
      return {
        content: [{ type: "text", text: "Error: No SQL statement provided" }],
        isError: true,
      };
    }

    // Begin a transaction
    await client.query("BEGIN");

    try {
      // Execute the SQL statement(s)
      const startTime = Date.now();
      const result = await client.query(sql);
      const execTime = Date.now() - startTime;

      // Automatically commit the transaction
      await client.query("COMMIT");

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
                message: `Error executing statement: ${error.message}`,
                sql: sql,
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
        content: [{ type: "text", text: "Error: No SQL statement provided" }],
        isError: true,
      };
    }

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
            text: "Error: Only VACUUM, ANALYZE and CREATE DATABASE commands are allowed",
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
              message: `Error executing statement: ${error.message}`,
              sql: sql,
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
      content: [{ type: "text", text: "Error: No table name provided" }],
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
    // Get all tables from the public schema
    const result = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
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
        table_name = $1
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
      [`public.${tableName}`],
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


import pg from "pg";
import { safelyReleaseClient } from "./utils";

export async function handleGetDatabaseSchema(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    // Get all tables with their columns, types, constraints, and indexes
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
        tc.constraint_type,
        i.indexname,
        i.indexdef
      FROM information_schema.tables t
      LEFT JOIN information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      LEFT JOIN information_schema.table_constraints tc ON t.table_name = tc.table_name AND t.table_schema = tc.table_schema
      LEFT JOIN pg_indexes i ON t.table_name = i.tablename
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name, c.ordinal_position, tc.constraint_name, i.indexname;
    `;

    const tablesResult = await client.query(tablesQuery);

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
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.column_name;
    `;

    const foreignKeysResult = await client.query(foreignKeysQuery);

    // Get views
    const viewsQuery = `
      SELECT 
        table_name,
        view_definition
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;

    const viewsResult = await client.query(viewsQuery);

    // Get functions
    const functionsQuery = `
      SELECT 
        routine_name,
        routine_type,
        data_type,
        routine_definition
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      ORDER BY routine_name;
    `;

    const functionsResult = await client.query(functionsQuery);

    // Get table statistics
    const statsQuery = `
      SELECT 
        schemaname,
        tablename,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        n_live_tuples,
        n_dead_tuples,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze
      FROM pg_stat_user_tables
      ORDER BY tablename;
    `;

    const statsResult = await client.query(statsQuery);

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

      if (row.indexname && !tables[row.table_name].indexes.find((i: any) => i.indexname === row.indexname)) {
        tables[row.table_name].indexes.push({
          indexname: row.indexname,
          indexdef: row.indexdef
        });
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
            message: `Error retrieving database schema: ${error.message}`,
            error: error.message
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
  limit: number = 100
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
              message: "Search term cannot be empty"
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
      WHERE t.table_schema = 'public' 
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
    const queryParams = [];
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
      
      if (!validTableName || !validColumnName) {
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
        FROM ${validTableName}
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
          FROM ${validTableName}
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
            message: `Error searching text: ${error.message}`,
            error: error.message
          }, null, 2)
        }
      ],
      isError: true
    };
  } finally {
    safelyReleaseClient(client);
  }
}