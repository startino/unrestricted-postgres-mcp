# Unrestricted PostgreSQL MCP Server

[![Model Context Protocol](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)
[![Apache License Version 2](https://img.shields.io/badge/License-APACHE-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6%2B-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Built%20with-Vite-646CFF.svg)](https://vitejs.dev/)

> **Fork of [mcp-postgres-full-access by Syahiid Nur Kamil](https://github.com/syahiidkamil/mcp-postgres-full-access)** - Enhanced with modern tooling, transaction recovery tools, and improved developer experience.

A powerful **Model Context Protocol (MCP) server** that provides **full read-write access** to PostgreSQL databases. Unlike read-only MCP servers, this implementation enables Large Language Models to safely query, modify, and manage database content with comprehensive transaction management and recovery capabilities.

## ✨ Key Features

### 🔐 **Safe Full Database Access**
- **Read Operations**: Execute SELECT queries with automatic read-only transaction protection
- **Write Operations**: Safely perform INSERT, UPDATE, DELETE with explicit transaction management
- **Schema Management**: Create, alter, and drop database objects with DDL operations
- **Maintenance Commands**: Execute VACUUM, ANALYZE, and CREATE DATABASE operations

### 🛡️ **Advanced Transaction Management**
- **Explicit Commit/Rollback**: Two-step process requiring user confirmation for all changes
- **Transaction Recovery**: Tools to recover from aborted transaction states
- **Timeout Protection**: Automatic rollback of abandoned transactions
- **Session Reset**: Complete session reset capabilities for stuck connections
- **Connection Status**: Real-time monitoring of database connection state

### 📊 **Rich Schema Information**
- **Comprehensive Metadata**: Detailed column information, data types, constraints
- **Relationship Mapping**: Primary keys, foreign keys, and index information
- **Performance Insights**: Row count estimates and table statistics
- **Documentation Support**: Table and column descriptions when available

### 🔧 **Developer Experience**
- **Modern Build System**: Powered by Vite for fast development and building
- **TypeScript Support**: Full type safety and IntelliSense support
- **Hot Reload**: Instant development server with `vite-node`
- **Comprehensive Tooling**: 10+ specialized tools for database operations

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18.0.0 or higher
- **PostgreSQL** 12.0 or higher
- **Claude Desktop** (for MCP integration)

### Installation

```bash
# Install globally
npm install -g unrestricted-postgres-mcp

# Or use with npx (recommended)
npx unrestricted-postgres-mcp postgresql://user:password@localhost:5432/database
```

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "postgres-unrestricted": {
      "command": "npx",
      "args": [
        "-y",
        "unrestricted-postgres-mcp",
        "postgresql://username:password@localhost:5432/database"
      ],
      "env": {
        "TRANSACTION_TIMEOUT_MS": "60000",
        "MAX_CONCURRENT_TRANSACTIONS": "5",
        "PG_STATEMENT_TIMEOUT_MS": "30000"
      }
    }
  }
}
```

## 🛠️ Available Tools

### **Query & Analysis Tools**

| Tool | Purpose | Parameters |
|------|---------|------------|
| `execute_query` | Execute read-only SELECT queries | `sql` (string) |
| `get_database_schema` | Get comprehensive database schema overview | None |
| `search_text` | Search text across tables using full-text search | `search_term` (string), `tables` (array, optional), `columns` (array, optional), `limit` (number, optional) |
| `list_tables` | List all tables in a schema | `schema_name` (string, optional) |
| `describe_table` | Get detailed table schema information | `table_name` (string), `schema_name` (string, optional) |

### **Data Modification Tools**

| Tool | Purpose | Parameters |
|------|---------|------------|
| `execute_dml_ddl_dcl_tcl` | Execute data modification operations (auto-committed) | `sql` (string) |
| `execute_maintenance` | Run maintenance commands (VACUUM, ANALYZE) | `sql` (string) |
| `execute_rollback` | Rollback a pending transaction | `transaction_id` (string) |

### **Transaction Management & Recovery**

| Tool | Purpose | Parameters |
|------|---------|------------|
| `list_transactions` | List all active transactions | None |
| `force_rollback` | Force rollback aborted transactions | None |
| `reset_session` | Reset database session completely | None |

## 🔄 Workflow Examples

### **Typical Usage Pattern**

1. Query data to understand current state
2. Execute modifications (automatically committed)
3. Query again to verify changes


### **Recovery from Stuck Transactions**

1. **Diagnose**: Use `list_transactions` to check state
2. **List**: Use `list_transactions` to see active transactions
3. **Recover**: Use `force_rollback` to clear aborted state
4. **Reset**: If needed, use `reset_session` for complete reset

### **Schema Exploration**

1. **Discover**: Use `list_tables` to see available tables
2. **Examine**: Use `describe_table` for detailed schema information
3. **Query**: Use `execute_query` to explore data patterns

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSACTION_TIMEOUT_MS` | `15000` | Transaction timeout in milliseconds |
| `MAX_CONCURRENT_TRANSACTIONS` | `10` | Maximum concurrent transactions |
| `PG_STATEMENT_TIMEOUT_MS` | `30000` | SQL statement execution timeout |
| `PG_MAX_CONNECTIONS` | `20` | Maximum PostgreSQL connections |
| `ENABLE_TRANSACTION_MONITOR` | `true` | Enable transaction monitoring |
| `MONITOR_INTERVAL_MS` | `5000` | Transaction monitor check interval |

### Security Best Practices

1. **Create Dedicated Database User**:
   ```sql
   CREATE USER mcp_user WITH PASSWORD 'secure_password';
   GRANT SELECT, INSERT, UPDATE, DELETE ON specific_tables TO mcp_user;
   ```

2. **Use "Allow Once" for All Operations**:
   - Never select "Always allow" for database modifications
   - Review all SQL operations before approval

3. **Test with Non-Production Data**:
   - Use a development database for initial testing
   - Implement regular backups before extensive use

## 🏗️ Development

### Prerequisites
- Node.js 18+
- pnpm (recommended) or npm
- PostgreSQL database

### Setup

```bash
# Clone the repository
git clone https://github.com/your-username/unrestricted-postgres-mcp.git
cd unrestricted-postgres-mcp

# Install dependencies
pnpm install

# Create environment file
cp .env.example .env
# Edit .env with your database connection details

# Start development server
pnpm run dev

# Build for production
pnpm run build
```

### Available Scripts

| Script | Purpose |
|--------|---------|
| `pnpm run dev` | Start development server with hot reload |
| `pnpm run build` | Build for production |
| `pnpm run start` | Run production build |
| `pnpm run type-check` | Run TypeScript type checking |

### Project Structure

```
src/
├── index.ts                 # Main server entry point
├── lib/
│   ├── config.ts           # Configuration management
│   ├── tool-handlers.ts    # Tool implementation functions
│   ├── transaction-manager.ts # Transaction lifecycle management
│   ├── types.ts            # TypeScript type definitions
│   └── utils.ts            # Utility functions
└── types.ts                # Additional type definitions
```

## 🔍 Troubleshooting

### Common Issues

**"Current transaction is aborted" Error**:
1. Use `list_transactions` to diagnose
2. Use `force_rollback` to clear aborted state
3. If still stuck, use `reset_session`

**Connection Timeouts**:
1. Check `PG_STATEMENT_TIMEOUT_MS` setting
2. Increase `TRANSACTION_TIMEOUT_MS` if needed
3. Verify database connection limits

**Permission Errors**:
1. Verify database user permissions
2. Check table-specific access rights
3. Ensure user has necessary schema access

## 📊 Comparison with Official MCP Servers

| Feature | This Server | Official PostgreSQL MCP |
|---------|-------------|-------------------------|
| Read Access | ✅ Enhanced | ✅ Basic |
| Write Access | ✅ Full Support | ❌ Not Available |
| Transaction Management | ✅ Advanced | ❌ Not Available |
| Schema Details | ✅ Comprehensive | ✅ Basic |
| Recovery Tools | ✅ Multiple Options | ❌ Not Available |
| Type Safety | ✅ Full TypeScript | ❌ Not Available |
| Modern Tooling | ✅ Vite + Hot Reload | ❌ Not Available |

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Quick Contribution Guide

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `pnpm run type-check && pnpm run build`
5. Commit changes: `git commit -m 'Add amazing feature'`
6. Push to branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

## 📄 License

This project is licensed under the **Apache License Version 2.0** - see the [LICENSE](LICENSE) file for details.

## 👥 Credits

- **Original Creator**: [Syahiid Nur Kamil](https://github.com/syahiidkamil) - [mcp-postgres-full-access](https://github.com/syahiidkamil/mcp-postgres-full-access)
- **Current Maintainer**: [Jonas Lindberg](https://github.com/eksno) - Enhanced version with modern tooling and recovery capabilities

## 🙏 Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/) for the MCP specification
- [Anthropic](https://www.anthropic.com/) for Claude and MCP integration
- [PostgreSQL](https://www.postgresql.org/) for the excellent database system
- [Vite](https://vitejs.dev/) for the modern build tooling

---

**⚠️ Important**: This server provides full database access. Always review operations before committing changes and use appropriate database user permissions for security.