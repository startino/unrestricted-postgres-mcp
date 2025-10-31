#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pg from "pg";

import config from "./lib/config";
import { TransactionManager } from "./lib/transaction-manager";
import { safelyReleaseClient } from "./lib/utils";
import {
  handleExecuteQuery,
  handleExecuteDML,
  handleExecuteMaintenance,
  handleListTables,
  handleDescribeTable,
  handleListResources,
  handleReadResource,
  handleListTransactions,
  handleForceRollback,
  handleResetSession,
  handleGetDatabaseSchema,
  handleSearchText,
} from "./lib/tool-handlers";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

// Process command line arguments
const resourceBaseUrl = new URL(config.pg.url);
resourceBaseUrl.protocol = "postgres:";
resourceBaseUrl.password = ""; // Remove password for security

// Create a connection pool with configured settings
const pool = new pg.Pool({
  connectionString: config.pg.url,
  max: config.pg.maxConnections,
  idleTimeoutMillis: config.pg.idleTimeoutMillis,
  statement_timeout: config.pg.statementTimeout,
});

// Create transaction manager
const transactionManager = new TransactionManager(
  config.transactionTimeoutMs,
  config.monitorIntervalMs,
  config.enableTransactionMonitor,
);

// Create MCP server
const server = new McpServer(
  {
    name: "postgres-advanced",
    version: "0.1.1",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

// Helper function to transform our handler responses into the correct format
function transformHandlerResponse(result: any) {
  if (!result) return result;

  const transformedResult = { ...result };

  if (result.content) {
    transformedResult.content = result.content.map((item: any) => {
      if (item.type === "text") {
        return {
          type: "text" as const,
          text: item.text,
        };
      }
      return item;
    });
  }

  return transformedResult;
}

// Register tools using the new high-level API
server.tool(
  "execute_query",
  `Run a read-only SQL query (SELECT statements). Use this to examine data, understand table structures, and verify changes. Executed in read-only mode for safety.

Args: { "sql": string }

Supports complex queries with:
- JOINs (INNER, LEFT, RIGHT, FULL OUTER)
- Subqueries and CTEs (Common Table Expressions)
- Aggregations (GROUP BY, HAVING)
- Window functions
- JSON operators and array functions
- PostgreSQL-specific features

Examples:
- Basic: "SELECT * FROM users WHERE age > 25"
- Complex: "WITH recent_orders AS (SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '30 days') SELECT u.name, COUNT(ro.id) FROM users u LEFT JOIN recent_orders ro ON u.id = ro.user_id GROUP BY u.id, u.name"
- JSON: "SELECT data->>'name' as name, data->'address'->>'city' as city FROM profiles WHERE data ? 'address'"

Note: Only SELECT statements are allowed. For other operations, use execute_dml_ddl_dcl_tcl.

Input format tips:
- Provide raw SQL only. Do not wrap in triple quotes or code fences.
- OK: "SELECT * FROM users;"  Not OK: "\`\`\`sql\nSELECT * FROM users;\n\`\`\`"

Bad examples (do not do this):
- { "sql": "UPDATE users SET ..." }  → Use execute_dml_ddl_dcl_tcl instead

Quick chooser: Use execute_query for SELECT/CTE/EXPLAIN/SHOW; use execute_dml_ddl_dcl_tcl for INSERT/UPDATE/DELETE/DDL/DCL/TCL.`,
  { 
    sql: z.string()
      .min(1, "SQL query cannot be empty")
      .describe("SQL SELECT query to execute - supports complex queries with JOINs, WHERE, GROUP BY, ORDER BY, etc.")
      .refine(
        (sql) => sql.trim().toUpperCase().startsWith('SELECT'),
        "Only SELECT queries are allowed. Use execute_dml_ddl_dcl_tcl for other operations."
      )
  },
  async (args, extra) => {
    try {
      const result = await handleExecuteQuery(pool, args.sql);
      return transformHandlerResponse(result);
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error);
      
      // Provide better error message for parameter validation issues
      if (errorMessage.includes("Cannot read properties of undefined") || 
          errorMessage.includes("_zod") ||
          errorMessage.includes("validation")) {
        errorMessage = `Invalid parameters for execute_query tool. Expected: { "sql": "SELECT * FROM table_name" }. Received: ${JSON.stringify(args)}`;
      }
      
      return {
        content: [
          {
            type: "text" as const,
            text: errorMessage,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "get_database_schema",
  `Get comprehensive database schema overview including all tables, columns, types, constraints, indexes, foreign keys, views, and functions. Use this to understand the complete database structure before writing queries.

Returns detailed information about:
- All tables with their columns, data types, and constraints
- Primary keys, foreign keys, and unique constraints
- Indexes and their columns
- Views and their definitions
- Functions and procedures
- Table relationships and dependencies

This tool is essential for:
- Understanding database structure before writing queries
- Discovering available tables and columns
- Understanding relationships between tables
- Planning complex queries with proper JOINs

Example usage: Call without parameters to get the complete schema overview.`,
  {
    schema_name: z.string()
      .optional()
      .default("public")
      .describe("Name of the schema to inspect (default: 'public')")
  },
  async (args, extra) => {
    try {
      const result = await handleGetDatabaseSchema(pool, args.schema_name);
      return transformHandlerResponse(result);
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error);
      
      // Provide better error message for parameter validation issues
      if (errorMessage.includes("Cannot read properties of undefined") || 
          errorMessage.includes("_zod") ||
          errorMessage.includes("validation")) {
        errorMessage = `Invalid parameters for get_database_schema tool. Expected: { \"schema_name\": \"public\" }. Received: ${JSON.stringify(args)}`;
      }
      
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: "Tool execution failed",
              details: errorMessage,
              tool: "get_database_schema",
              suggestion: "Check tool parameters and try again"
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "execute_dml_ddl_dcl_tcl",
  `Execute DML, DDL, DCL, or TCL statements (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, GRANT/REVOKE, COMMIT/ROLLBACK). Changes are automatically committed.

Args: { "sql": string, "params"?: any[] }  — params supports string | number | boolean | null (max 50).

IMPORTANT: Always use parameterized queries for any text values. Provide SQL with $1, $2, $3 placeholders and pass values via the top-level params array.

Good examples (copy-paste safe):
- Insert:
  { "sql": "INSERT INTO users (name, email) VALUES ($1, $2)", "params": ["John", "john@example.com"] }
- Update:
  { "sql": "UPDATE users SET last_login = NOW() WHERE name = $1", "params": ["Alice"] }
- Upsert:
  { "sql": "INSERT INTO users (id, name, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name", "params": [1, "John", "john@example.com"] }
- Long text with special characters:
  { "sql": "UPDATE echo_air.icrb_data SET field_value_enriched = $1, enrichment_population_notes = $2, enrichment_sources_used = $3, status = 'Enriched', last_updated = NOW() WHERE engagement_id = $4 AND field_id = $5;", "params": ["<long text>", "<notes>", "<sources>", 126, 24] }

Anti-patterns (will fail):
- Embedding params into the SQL string:
  { "sql": "UPDATE ...;\n</parameter name>\n<parameter name=\"params\">[\"...\"]" }
  Reason: The tool does not parse inline or XML-serialized params; params must be a separate top-level JSON array.
- Using SELECT here:
  { "sql": "SELECT * FROM users" }  → Use execute_query instead.

Input format tips:
- Provide raw SQL only. Do not wrap in triple quotes or code fences.
- OK: "UPDATE t SET c='x';"  Not OK: "'''\nUPDATE t SET c='x';\n'''"

Supported operations:
- DML: INSERT, UPDATE, DELETE, UPSERT (INSERT...ON CONFLICT)
- DDL: CREATE, ALTER, DROP (tables, indexes, views, functions)
- DCL: GRANT, REVOKE (permissions)
- TCL: BEGIN, COMMIT, ROLLBACK (transactions)

Note: All operations are automatically committed. Use execute_query for read-only operations.

Quick chooser: Use execute_query for SELECT/CTE/EXPLAIN/SHOW; use execute_dml_ddl_dcl_tcl for INSERT/UPDATE/DELETE/DDL/DCL/TCL.`,
  {
    sql: z.string()
      .min(1, "SQL statement cannot be empty")
      .describe("SQL statement with $1, $2, $3 placeholders for parameters (STRONGLY RECOMMENDED) OR raw SQL. Always use placeholders for text values to avoid quoting errors.")
      .refine(
        (sql) => {
          const trimmed = sql.trim().toUpperCase();
          return !trimmed.startsWith('SELECT');
        },
        "SELECT queries should use execute_query tool for safety. This tool is for data modification operations."
      ),
    params: z.array(z.any())
      .max(50, "A maximum of 50 parameters is allowed")
      .optional()
      .describe("Array of values to substitute for $1, $2, $3, etc. in the SQL. ALWAYS use this for text values, especially long content or content with quotes/HTML/special characters. Supported types: string, number, boolean, null."),
  },
  async (args, extra) => {
    try {
      const result = await handleExecuteDML(pool, args.sql, args.params);
      return transformHandlerResponse(result);
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error);
      
      // Provide better error message for parameter validation issues
      if (errorMessage.includes("Cannot read properties of undefined") || 
          errorMessage.includes("_zod") ||
          errorMessage.includes("validation")) {
        errorMessage = `Invalid parameters for execute_dml_ddl_dcl_tcl tool. Expected: { "sql": "INSERT INTO table_name VALUES (...)" }. Received: ${JSON.stringify(args)}`;
      }
      
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: "Tool execution failed",
              details: errorMessage,
              tool: "execute_dml_ddl_dcl_tcl",
              suggestion: "Check SQL syntax and ensure all referenced tables/columns exist"
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "execute_maintenance",
  "Execute maintenance commands like VACUUM, ANALYZE, or CREATE DATABASE outside of transactions",
  {
    sql: z
      .string()
      .describe(
        "SQL statement to execute - must be VACUUM, ANALYZE, or CREATE DATABASE",
      ),
  },
  async (args, extra) => {
    try {
      const result = await handleExecuteMaintenance(pool, args.sql);
      return transformHandlerResponse(result);
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error);
      
      // Provide better error message for parameter validation issues
      if (errorMessage.includes("Cannot read properties of undefined") || 
          errorMessage.includes("_zod") ||
          errorMessage.includes("validation")) {
        errorMessage = `Invalid parameters for execute_maintenance tool. Expected: { "sql": "VACUUM table_name" }. Received: ${JSON.stringify(args)}`;
      }
      
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: "Tool execution failed",
              details: errorMessage,
              tool: "execute_maintenance",
              suggestion: "Check command syntax and ensure you have necessary privileges for maintenance operations"
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  },
);


server.tool(
  "execute_rollback",
  "Rollback a transaction by its ID to undo all changes and discard the transaction",
  {
    transaction_id: z
      .string()
      .describe(
        "ID of the transaction to rollback - this will discard all changes",
      ),
  },
  async (args, extra) => {
    try {
      // Implement the rollback handler directly in index.ts
      const transactionId = args.transaction_id;

      if (!transactionManager.hasTransaction(transactionId)) {
        return {
          content: [
            {
              type: "text" as const,
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
              type: "text" as const,
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
            type: "text" as const,
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
              "\n\nTransaction has been successfully rolled back. No changes have been made to the database.\n\nThank you for using PostgreSQL Full Access MCP Server. Is there anything else you'd like to do with your database?",
          },
        ],
        isError: false,
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  },
);

// Remove prompts since we don't need them, just keeping the direct confirm/rollback model
server.tool(
  "list_tables",
  `Get a list of all tables in the database's schema. Use this to discover available tables before writing queries or exploring the database structure.

Returns:
- Table names and types (BASE TABLE, VIEW, etc.)
- Table schemas and owners
- Row counts and table sizes
- Creation timestamps

This tool is useful for:
- Discovering available tables in a schema
- Understanding database structure
- Planning queries and operations
- Database exploration and documentation

Examples:
- List all tables in public schema: schema_name="public"
- List tables in specific schema: schema_name="analytics"

Note: Defaults to 'public' schema if not specified.`,
  { 
    schema_name: z.string()
      .optional()
      .default("public")
      .describe("Name of the schema to list tables from (default: 'public')")
  },
  async (args, extra) => {
    try {
      const result = await handleListTables(pool, args.schema_name);
      return transformHandlerResponse(result);
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error);
      
      // Provide better error message for parameter validation issues
      if (errorMessage.includes("Cannot read properties of undefined") || 
          errorMessage.includes("_zod") ||
          errorMessage.includes("validation")) {
        errorMessage = `Invalid parameters for list_tables tool. Expected: { "schema_name": "public" }. Received: ${JSON.stringify(args)}`;
      }
      
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: "Tool execution failed",
              details: errorMessage,
              tool: "list_tables",
              suggestion: "Check schema name and ensure it exists in the database"
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "describe_table",
  `Get detailed information about a specific table, including columns, primary keys, foreign keys, and indexes. Use this to understand table structure before writing queries.

Returns detailed information about:
- All columns with data types, nullability, and defaults
- Primary keys and unique constraints
- Foreign key relationships and references
- Indexes and their columns
- Table statistics (row count, size)
- Column comments and descriptions

This tool is essential for:
- Understanding table structure before writing queries
- Discovering column names and types
- Understanding relationships between tables
- Planning JOINs and complex queries
- Database documentation and exploration

Examples:
- Describe users table: table_name="users", schema_name="public"
- Describe table in specific schema: table_name="orders", schema_name="analytics"

Note: Defaults to 'public' schema if not specified.`,
  {
    table_name: z.string()
      .min(1, "Table name cannot be empty")
      .describe("Name of the table to describe"),
    schema_name: z.string()
      .optional()
      .default("public")
      .describe("Name of the schema containing the table (default: 'public')"),
  },
  async (args, extra) => {
    try {
      const result = await handleDescribeTable(
        pool,
        args.table_name,
        args.schema_name,
      );
      return transformHandlerResponse(result);
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error);
      
      // Provide better error message for parameter validation issues
      if (errorMessage.includes("Cannot read properties of undefined") || 
          errorMessage.includes("_zod") ||
          errorMessage.includes("validation")) {
        errorMessage = `Invalid parameters for describe_table tool. Expected: { "table_name": "users", "schema_name": "public" }. Received: ${JSON.stringify(args)}`;
      }
      
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: "Tool execution failed",
              details: errorMessage,
              tool: "describe_table",
              suggestion: "Check table and schema names and ensure they exist in the database"
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "list_transactions",
  "List all currently active transactions with their details including ID, start time, duration, state, and SQL preview",
  {},
  async (args, extra) => {
    try {
      const result = await handleListTransactions(transactionManager);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "force_rollback",
  "Force rollback any aborted transactions to clear blocked database state. Use this when you get 'current transaction is aborted' errors.",
  {},
  async (args, extra) => {
    try {
      const result = await handleForceRollback(pool);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "reset_session",
  "Completely reset the database session to clear all transaction state and connection issues. Use this as a last resort when force_rollback doesn't work.",
  {},
  async (args, extra) => {
    try {
      const result = await handleResetSession(pool);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "search_text",
  `Search text across database tables using PostgreSQL's full-text search capabilities. Supports searching multiple columns and tables with ranking and highlighting. Use this for content search, finding records by text content, or implementing search functionality.

Features:
- Full-text search with PostgreSQL's to_tsvector and plainto_tsquery
- Automatic fallback to ILIKE pattern matching if full-text search fails
- Ranking and relevance scoring (results sorted by relevance)
- Text highlighting with context
- Search across multiple tables and columns
- Configurable result limits with intelligent defaults

Search capabilities:
- Natural language search (handles stemming, stop words)
- Phrase search with quotes
- Boolean operators (AND, OR, NOT)
- Wildcard patterns (with ILIKE fallback)

Result limits - choose appropriately (max 50 to prevent token overload):
- Default (5): Quick preview, testing, general exploration - returns most relevant matches
- 10-20: Moderate search for specific content - good for focused queries
- 25-40: Comprehensive search when you need broader results - useful for analytics
- 40-50: Maximum for extensive analysis - returns all available relevant matches

Performance considerations:
- Lower limits (5-15) are faster and use less memory
- Moderate limits (20-30) balance comprehensiveness with performance
- Higher limits (40-50) may increase processing time but stay within token limits
- Results are pre-ranked by relevance, so most important matches appear first
- Maximum limit of 50 ensures responses stay within LLM context limits

Examples:
- Quick preview: search_term="error log", limit=5 (default)
- Focused search: search_term="database management", tables=["documents"], limit=15
- Broad exploration: search_term="user@example.com", columns=["email", "username"], limit=30
- Comprehensive analysis: search_term="error", limit=50

Note: Searches text, varchar, and char columns. Use execute_query for exact matches or complex filtering.`,
  {
    search_term: z.string()
      .min(1, "Search term cannot be empty")
      .describe("Text to search for - supports natural language, phrases, and boolean operators"),
    tables: z.array(z.string())
      .optional()
      .describe("Specific tables to search (optional - searches all tables if not provided)"),
    columns: z.array(z.string())
      .optional()
      .describe("Specific columns to search (optional - searches all text columns if not provided)"),
    limit: z.number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(5)
      .describe("Maximum number of results to return, ranked by relevance. Use 5-10 for quick previews, 15-30 for focused search, 40-50 for comprehensive results. Maximum: 50. Default: 5 (fast, shows most relevant matches)"),
    schema_name: z.string()
      .optional()
      .default("public")
      .describe("Name of the schema to search within (default: 'public')"),
  },
  async (args, extra) => {
    try {
      const result = await handleSearchText(pool, args.search_term, args.tables, args.columns, args.limit, args.schema_name);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  },
);


// Register resources using the new API
// First, create a resource template for table schemas
const tableSchemaTemplate = new URL(`{tableName}/schema`, resourceBaseUrl);

// Add a resource for listing all available table schemas
server.resource(
  "database-schemas",
  resourceBaseUrl.href,
  { description: "Database schema listings" },
  async (uri, _extra) => {
    try {
      const result = await handleListResources(pool, resourceBaseUrl);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result.resources, null, 2),
          },
        ],
      };
    } catch (error) {
      throw error;
    }
  },
);

// Add a resource for individual table schemas
server.resource(
  "table-schemas",
  tableSchemaTemplate.href,
  { description: "Database table schemas" },
  async (uri, _extra) => {
    try {
      return await handleReadResource(pool, uri.href);
    } catch (error) {
      throw error;
    }
  },
);

// Start the MCP server
async function runServer() {
  console.error("Starting PostgreSQL Advanced MCP server...");

  // Log configuration
  console.error(`Configuration:
- Transaction timeout: ${config.transactionTimeoutMs}ms
- Monitor interval: ${config.monitorIntervalMs}ms
- Transaction monitor enabled: ${config.enableTransactionMonitor}
- Max concurrent transactions: ${config.maxConcurrentTransactions}
- Max DB connections: ${config.pg.maxConnections}
`);

  // Set up error handling for the pool
  pool.on("error", (err) => {
    console.error("Unexpected error on idle client", err);
    process.exit(1);
  });

  try {
    // Test database connection
    const client = await pool.connect();
    console.error("Successfully connected to database");
    safelyReleaseClient(client);

    // Start transaction monitor
    transactionManager.startMonitor();

    // Start the MCP server with stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP server started and ready to accept connections");
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", async (reason, promise) => {
  console.error("Unhandled promise rejection:", reason);
  try {
    // Stop the monitor and cleanup before exiting
    transactionManager.stopMonitor();
    await transactionManager.cleanupTransactions();
    await pool.end();
    console.error(
      "Emergency cleanup completed after unhandled promise rejection",
    );
  } catch (err) {
    console.error("Error during emergency cleanup:", err);
  }
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.error("Shutting down...");
  try {
    transactionManager.stopMonitor();
    await transactionManager.cleanupTransactions();
    await pool.end();
    console.error("Database pool closed");
  } catch (err) {
    console.error("Error during shutdown:", err);
  }
  process.exit(0);
});

// Handle unexpected errors
process.on("uncaughtException", async (error) => {
  console.error("Uncaught exception:", error);
  try {
    transactionManager.stopMonitor();
    await transactionManager.cleanupTransactions();
    await pool.end();
  } catch (err) {
    console.error("Error during emergency cleanup:", err);
  }
  process.exit(1);
});

runServer().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Set up Express and HTTP transport
const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  // Create a new transport for each request to prevent request ID collisions
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || "3000");
app
  .listen(port, () => {
    console.error(`MCP Server running on http://localhost:${port}/mcp`);
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
