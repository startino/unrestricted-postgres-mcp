---
name: Bug Report
about: Create a report to help us improve the MCP server
title: '[BUG] '
labels: bug
assignees: ''
---

## 🐛 Bug Description

A clear and concise description of what the bug is.

## 🔄 Steps to Reproduce

1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

## 🎯 Expected Behavior

A clear and concise description of what you expected to happen.

## 📱 Actual Behavior

A clear and concise description of what actually happened.

## 📊 Environment Information

- **Node.js Version**: [e.g. 18.17.0]
- **PostgreSQL Version**: [e.g. 15.3]
- **Operating System**: [e.g. macOS 13.5, Ubuntu 22.04, Windows 11]
- **MCP Client**: [e.g. Claude Desktop 1.0.0]
- **Package Version**: [e.g. 0.3.0]

## 📝 Configuration

```json
{
  "mcpServers": {
    "postgres-unrestricted": {
      "command": "npx",
      "args": ["-y", "unrestricted-postgres-mcp", "postgresql://..."],
      "env": {
        "TRANSACTION_TIMEOUT_MS": "15000",
        "MAX_CONCURRENT_TRANSACTIONS": "10"
      }
    }
  }
}
```

## 📋 Error Logs

```
Paste any relevant error logs here
```

## 🔍 Additional Context

Add any other context about the problem here.

## ✅ Checklist

- [ ] I have searched existing issues to avoid duplicates
- [ ] I have provided all required environment information
- [ ] I have included steps to reproduce the issue
- [ ] I have included relevant error logs
- [ ] I have tested with the latest version