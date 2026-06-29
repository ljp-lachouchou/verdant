---
name: git-release
description: Guide for creating git releases, tags, and changelogs. Use when the user wants to publish a release, create a version tag, or generate release notes.
---

# Git Release Skill

This skill guides you through creating a proper git release.

## Steps

1. **Check current version**
   - Run `git describe --tags --abbrev=0` to get the latest tag
   - If no tags exist, start with `v0.1.0`

2. **Determine version bump**
   - Major (X.0.0): Breaking changes
   - Minor (0.X.0): New features, backward compatible
   - Patch (0.0.X): Bug fixes only

3. **Generate changelog**
   - Run `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
   - Categorize commits: Features, Fixes, Breaking Changes, Other

4. **Create tag**
   - `git tag -a vX.Y.Z -m "Release vX.Y.Z"`

5. **Push**
   - `git push origin main --tags`

## Changelog Format

```
## vX.Y.Z (YYYY-MM-DD)

### Breaking Changes
- ...

### Features
- ...

### Fixes
- ...
```

## Rules
- Always check for uncommitted changes before tagging
- Use annotated tags (`-a`), not lightweight tags
- Include the changelog in the tag message
