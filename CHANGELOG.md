# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Transaction recovery tools (`force_rollback`, `reset_session`)
- `list_transactions` tool for monitoring active transactions
- Modern Vite-based build system with hot reload
- TypeScript support with full type safety
- Comprehensive error handling and recovery mechanisms

### Changed
- Migrated from ts-node to Vite for development and building
- Simplified TypeScript configuration (removed multiple tsconfig files)
- Enhanced transaction management with better error recovery
- Improved import paths and module resolution
- **BREAKING**: Removed manual commit system - all DML operations now auto-commit
- Removed `execute_commit` tool as transactions are automatically committed

### Fixed
- Resolved import hell between TypeScript and JavaScript modules
- Fixed aborted transaction state blocking database operations
- Improved connection cleanup and resource management

## [0.3.0] - 2024-10-10

### Added
- Initial fork from [mcp-postgres-full-access](https://github.com/syahiidkamil/mcp-postgres-full-access)
- Full read-write access to PostgreSQL databases
- Transaction management with explicit commit/rollback
- Rich schema information and metadata
- Safety controls and timeout protection
- Claude Desktop integration support

### Features
- `execute_query` - Read-only SQL query execution
- `execute_dml_ddl_dcl_tcl` - Data modification operations
- `execute_maintenance` - Maintenance commands (VACUUM, ANALYZE)
- `execute_commit` - Transaction commit
- `execute_rollback` - Transaction rollback
- `list_tables` - Table listing with metadata
- `describe_table` - Detailed table schema information
- `list_resources` - Resource discovery
- `read_resource` - Resource content access

## [0.2.0] - 2024-XX-XX (Original Project)

### Added
- Basic MCP server functionality
- PostgreSQL connection management
- Read-only query execution
- Basic schema information

## [0.1.0] - 2024-XX-XX (Original Project)

### Added
- Initial release
- Basic PostgreSQL MCP server
- Read-only database access

---

## Legend

- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** for vulnerability fixes