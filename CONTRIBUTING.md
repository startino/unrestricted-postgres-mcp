# Contributing to Unrestricted PostgreSQL MCP Server

Thank you for your interest in contributing to the Unrestricted PostgreSQL MCP Server! This document provides guidelines and information for contributors.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Contributing Guidelines](#contributing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)

## 🤝 Code of Conduct

This project adheres to a code of conduct that we expect all contributors to follow. By participating, you agree to uphold this code.

### Our Pledge

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect different viewpoints and experiences
- Accept responsibility for our mistakes

## 🚀 Getting Started

### Prerequisites

Before contributing, ensure you have:

- **Node.js** 18.0.0 or higher
- **pnpm** (recommended) or npm
- **PostgreSQL** 12.0 or higher (for testing)
- **Git** for version control
- A code editor with TypeScript support (VS Code recommended)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/unrestricted-postgres-mcp.git
   cd unrestricted-postgres-mcp
   ```
3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/eksno/unrestricted-postgres-mcp.git
   ```

## 🛠️ Development Setup

### Installation

```bash
# Install dependencies
pnpm install

# Create environment file
cp .env.example .env
```

### Environment Configuration

Create a `.env` file with your test database configuration:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/test_database
TRANSACTION_TIMEOUT_MS=15000
MAX_CONCURRENT_TRANSACTIONS=10
PG_STATEMENT_TIMEOUT_MS=30000
PG_MAX_CONNECTIONS=20
ENABLE_TRANSACTION_MONITOR=true
MONITOR_INTERVAL_MS=5000
```

### Development Commands

```bash
# Start development server with hot reload
pnpm run dev

# Build for production
pnpm run build

# Run type checking
pnpm run type-check

# Start production server
pnpm run start
```

## 📝 Contributing Guidelines

### Types of Contributions

We welcome several types of contributions:

- **🐛 Bug Fixes**: Fix existing issues
- **✨ New Features**: Add new functionality
- **📚 Documentation**: Improve documentation
- **🧪 Tests**: Add or improve tests
- **🔧 Tooling**: Improve development experience
- **🎨 Code Quality**: Refactoring and code improvements

### Before You Start

1. **Check existing issues** to see if your contribution is already being worked on
2. **Create an issue** for significant changes to discuss the approach
3. **Read the codebase** to understand the architecture and patterns
4. **Follow the coding standards** outlined below

## 🔄 Pull Request Process

### Creating a Pull Request

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-number-description
   ```

2. **Make your changes** following the coding standards

3. **Test your changes**:
   ```bash
   pnpm run type-check
   pnpm run build
   # Test manually with your database
   ```

4. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add new transaction recovery tool"
   ```

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request** on GitHub

### Pull Request Guidelines

- **Use descriptive titles** that clearly explain what the PR does
- **Provide detailed descriptions** of changes and motivation
- **Reference related issues** using `Fixes #123` or `Closes #123`
- **Include screenshots** for UI changes (if applicable)
- **Keep PRs focused** - one feature or fix per PR
- **Update documentation** if you add new features

### Commit Message Format

We follow conventional commit format:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples**:
```
feat(tools): add force_rollback tool for transaction recovery
fix(transaction): handle aborted transaction state properly
docs(readme): update installation instructions
```

## 🐛 Issue Reporting

### Before Creating an Issue

1. **Search existing issues** to avoid duplicates
2. **Check if it's already fixed** in the latest version
3. **Gather relevant information** about your environment

### Issue Template

When creating an issue, please include:

- **Clear title** describing the problem
- **Detailed description** of the issue
- **Steps to reproduce** the problem
- **Expected behavior** vs actual behavior
- **Environment information**:
  - Node.js version
  - PostgreSQL version
  - Operating system
  - MCP client (Claude Desktop, etc.)
- **Relevant logs** or error messages
- **Screenshots** (if applicable)

### Issue Labels

We use labels to categorize issues:

- `bug`: Something isn't working
- `enhancement`: New feature or request
- `documentation`: Improvements to documentation
- `good first issue`: Good for newcomers
- `help wanted`: Extra attention is needed
- `question`: Further information is requested

## 📏 Coding Standards

### TypeScript Guidelines

- **Use TypeScript** for all new code
- **Define proper types** for all functions and variables
- **Use interfaces** for object shapes
- **Prefer type over interface** for simple types
- **Use strict type checking** - no `any` unless absolutely necessary

### Code Style

- **Use 2 spaces** for indentation
- **Use semicolons** consistently
- **Use single quotes** for strings
- **Use trailing commas** in objects and arrays
- **Use meaningful variable names**
- **Keep functions small** and focused
- **Add JSDoc comments** for public functions

### File Organization

- **Group related functionality** in the same file
- **Use descriptive file names**
- **Keep files under 300 lines** when possible
- **Export functions** that are used elsewhere
- **Use barrel exports** for clean imports

### Example Code Style

```typescript
/**
 * Handles force rollback of aborted transactions
 * @param pool - PostgreSQL connection pool
 * @returns Promise with rollback result
 */
export async function handleForceRollback(
  pool: pg.Pool,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean }> {
  const client = await pool.connect();
  
  try {
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
```

## 🧪 Testing

### Manual Testing

Since this is an MCP server, testing involves:

1. **Start the development server**: `pnpm run dev`
2. **Connect with Claude Desktop** or another MCP client
3. **Test each tool** with various scenarios
4. **Verify error handling** with invalid inputs
5. **Check transaction management** with multiple operations

### Test Scenarios

For each tool, test:

- **Happy path**: Normal operation with valid inputs
- **Error cases**: Invalid inputs, database errors, connection issues
- **Edge cases**: Empty results, large datasets, special characters
- **Transaction scenarios**: Commit, rollback, timeout, recovery

### Database Setup for Testing

Create a test database with sample data:

```sql
-- Create test database
CREATE DATABASE mcp_test;

-- Connect to test database and create sample tables
\c mcp_test;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample data
INSERT INTO users (name, email) VALUES 
  ('John Doe', 'john@example.com'),
  ('Jane Smith', 'jane@example.com');

INSERT INTO posts (user_id, title, content) VALUES 
  (1, 'First Post', 'This is my first post'),
  (2, 'Hello World', 'Hello from Jane!');
```

## 📚 Documentation

### Documentation Standards

- **Keep documentation up-to-date** with code changes
- **Use clear, concise language**
- **Include code examples** where helpful
- **Explain the "why"** not just the "what"
- **Use proper markdown formatting**

### Types of Documentation

- **README.md**: Project overview and quick start
- **CONTRIBUTING.md**: This file
- **Code comments**: Inline documentation
- **JSDoc**: Function and class documentation
- **Issue templates**: For bug reports and feature requests

### Updating Documentation

When making changes that affect:

- **API changes**: Update README.md tool descriptions
- **New features**: Add to README.md features list
- **Configuration**: Update environment variables section
- **Installation**: Update setup instructions
- **Development**: Update this CONTRIBUTING.md file

## 🎯 Good First Issues

Looking for your first contribution? Here are some good starting points:

- **Documentation improvements**: Fix typos, improve clarity
- **Code comments**: Add JSDoc comments to functions
- **Error messages**: Improve error message clarity
- **Type definitions**: Add missing TypeScript types
- **Configuration**: Add new environment variables
- **Tool descriptions**: Improve tool documentation

## 🏷️ Release Process

### Version Numbering

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Release Checklist

Before releasing:

- [ ] All tests pass
- [ ] Documentation is updated
- [ ] CHANGELOG.md is updated
- [ ] Version number is bumped
- [ ] Release notes are prepared

## 💬 Getting Help

- **GitHub Issues**: For bug reports and feature requests
- **Discussions**: For questions and general discussion
- **Code Review**: Ask for help in pull request comments

## 🙏 Recognition

Contributors will be recognized in:

- **README.md**: Listed as contributors
- **Release notes**: Mentioned for significant contributions
- **GitHub**: Shown in the contributors graph

Thank you for contributing to the Unrestricted PostgreSQL MCP Server! 🎉