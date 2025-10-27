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
  "Run a read-only SQL query (SELECT statements). Use this to examine data, understand table structures, and verify changes. Executed in read-only mode for safety. Supports complex queries with JOINs, subqueries, aggregations, etc.",
  { sql: z.string().describe("SQL SELECT query to execute - supports complex queries with JOINs, WHERE, GROUP BY, ORDER BY, etc.") },
  async (args, extra) => {
    try {
      const result = await handleExecuteQuery(pool, args.sql);
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
  "get_database_schema",
  "Get comprehensive database schema overview including all tables, columns, types, constraints, indexes, foreign keys, views, and functions. Use this to understand the complete database structure before writing queries.",
  {},
  async (args, extra) => {
    try {
      const result = await handleGetDatabaseSchema(pool);
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
  "execute_dml_ddl_dcl_tcl",
  "Execute DML, DDL, DCL, or TCL statements (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, etc). Supports multiple semicolon-separated statements in one transaction - batch all related operations into a single call. Changes are automatically committed. Supports PostgreSQL features: COPY for bulk operations, INSERT...ON CONFLICT for upserts, window functions, CTEs, JSON operators, array functions, range types, and advanced data types.",
  {
    sql: z.string().describe("SQL statement(s) to execute - supports multiple semicolon-separated statements, COPY operations, upserts, window functions, CTEs, and all PostgreSQL features"),
  },
  async (args, extra) => {
    try {
      const result = await handleExecuteDML(pool, args.sql);
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
  "Get a list of all tables in the database's schema, default is 'public'",
  { schema_name: z.string().describe("Name of the schema") },
  async (args, extra) => {
    try {
      const result = await handleListTables(pool, args.schema_name);
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
  "describe_table",
  "Get detailed information about a specific table, including columns, primary keys, foreign keys, and indexes",
  {
    table_name: z.string().describe("Name of the table to describe"),
    schema_name: z.string().describe("Name of the schema").default("public"),
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
  "Search text across database tables using PostgreSQL's full-text search capabilities. Supports searching multiple columns and tables with ranking and highlighting. Use this for content search, finding records by text content, or implementing search functionality.",
  {
    search_term: z.string().describe("Text to search for"),
    tables: z.array(z.string()).optional().describe("Specific tables to search (optional - searches all tables if not provided)"),
    columns: z.array(z.string()).optional().describe("Specific columns to search (optional - searches all text columns if not provided)"),
    limit: z.number().optional().describe("Maximum number of results to return (default: 100)"),
  },
  async (args, extra) => {
    try {
      const result = await handleSearchText(pool, args.search_term, args.tables, args.columns, args.limit);
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
    console.log(`MCP Server running on http://localhost:${port}/mcp`);
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
