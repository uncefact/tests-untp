# Contributing to tests-untp

## Commit Message Guidelines

This project follows the [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) specification for commit messages.

Please read the official specification and ensure your commits follow this format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Common Types

- **feat**: New feature
- **fix**: Bug fix
- **refactor**: Code refactor
- **docs**: Documentation changes
- **test**: Adding or updating tests
- **chore**: Maintenance tasks

### Examples

```
# New features or significant enhancements
git commit -m "feat: add real-time data synchronization"

# Bug fixes and error corrections
git commit -m "fix: prevent memory leak in background tasks"

# Code refactor
git commit -m "refactor: improve code organization in storage service"

# Adding or updating tests
git commit -m "test: add unit tests for storage service"

# Documentation only changes
git commit -m "docs: update README with new features"

# Maintenance tasks and other miscellaneous changes
git commit -m "chore: cleanup unused variables"
```

### Breaking Changes

Breaking changes must be indicated by appending a `!` after the type/scope in the commit header.

Example:

```
feat(validator)!: require Node.js 21 for schema validation
```

For a complete guide on types and more detailed information, refer to the [official documentation](https://www.conventionalcommits.org/en/v1.0.0/).
