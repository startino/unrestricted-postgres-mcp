# Security Policy

## Supported Versions

We provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | :white_check_mark: |
| < 0.3   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security vulnerability, please follow these steps:

### 1. **DO NOT** create a public GitHub issue

Security vulnerabilities should be reported privately to avoid potential exploitation.

### 2. Report via Email

Please email security details to: [security@your-domain.com]

Include the following information:
- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact assessment
- Any suggested fixes or mitigations

### 3. Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Fix Development**: Within 30 days (for critical issues)
- **Public Disclosure**: After fix is available and tested

### 4. Responsible Disclosure

We follow responsible disclosure practices:
- We will not publicly disclose the vulnerability until a fix is available
- We will credit you in our security advisories (unless you prefer to remain anonymous)
- We will work with you to ensure the fix addresses the issue properly

## Security Considerations

### Database Access

This MCP server provides **full read-write access** to PostgreSQL databases. Consider these security implications:

#### 1. **Database User Permissions**
- Create dedicated database users with minimal required permissions
- Avoid using superuser or admin accounts
- Grant table-specific permissions when possible
- Regularly audit user permissions

#### 2. **Network Security**
- Use encrypted connections (SSL/TLS) when possible
- Consider network-level restrictions
- Use strong authentication methods
- Monitor connection logs

#### 3. **Data Sensitivity**
- Never expose sensitive data to LLMs
- Consider data classification and access controls
- Implement data masking for sensitive fields
- Regular security audits of data access

### MCP Client Security

#### 1. **Claude Desktop Integration**
- Always use "Allow Once" for database operations
- Never select "Always Allow" for write operations
- Review all SQL operations before approval
- Keep Claude Desktop updated

#### 2. **Environment Variables**
- Store sensitive configuration in environment variables
- Use strong, unique passwords
- Rotate credentials regularly
- Never commit credentials to version control

### Code Security

#### 1. **Input Validation**
- All SQL inputs are validated and sanitized
- Transaction timeouts prevent runaway operations
- Connection limits prevent resource exhaustion
- Error messages don't expose sensitive information

#### 2. **Dependencies**
- Regular dependency updates
- Security vulnerability scanning
- Minimal dependency footprint
- Trusted package sources only

## Security Best Practices

### For Users

1. **Use Test Databases**: Test with non-production data first
2. **Regular Backups**: Implement automated database backups
3. **Monitor Access**: Log and monitor database access
4. **Update Regularly**: Keep the MCP server and dependencies updated
5. **Review Operations**: Always review SQL operations before approval

### For Developers

1. **Code Review**: All code changes require review
2. **Security Testing**: Regular security testing and audits
3. **Dependency Management**: Keep dependencies updated and secure
4. **Input Validation**: Validate and sanitize all inputs
5. **Error Handling**: Secure error handling without information leakage

## Security Features

### Built-in Protections

- **Transaction Timeouts**: Automatic rollback of long-running transactions
- **Connection Limits**: Prevents connection exhaustion
- **Input Validation**: SQL query validation and classification
- **Error Sanitization**: Error messages don't expose sensitive data
- **Resource Cleanup**: Proper cleanup of database connections

### Monitoring

- **Transaction Monitoring**: Automatic detection of stuck transactions
- **Connection Status**: Real-time connection state monitoring
- **Error Logging**: Comprehensive error logging for debugging
- **Performance Metrics**: Execution time tracking and limits

## Incident Response

In case of a security incident:

1. **Immediate Response**: Disable affected systems if necessary
2. **Assessment**: Determine scope and impact
3. **Containment**: Prevent further exploitation
4. **Recovery**: Restore systems with fixes
5. **Post-Incident**: Review and improve security measures

## Contact

For security-related questions or concerns:

- **Email**: [security@your-domain.com]
- **GitHub Security Advisories**: [GitHub Security Tab]
- **Issues**: Use private reporting for security issues

## Acknowledgments

We appreciate the security research community and responsible disclosure practices. Security researchers who help us improve our security posture will be acknowledged in our security advisories.

---

**Last Updated**: October 10, 2024