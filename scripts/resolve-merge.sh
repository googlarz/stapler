#!/usr/bin/env bash
# Resolve merge conflicts: take theirs (upstream) and apply our naming conventions
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Apply substitutions to a file: STAPLER_ -> STAPLER_ for env vars,
# @stapler/ -> @stapler/ for internal packages
apply_subs() {
  local file="$1"
  # Internal package scope
  sed -i '' 's|@stapler/|@stapler/|g' "$file"
  # Env var prefix (must come after package scope)
  sed -i '' 's|STAPLER_|STAPLER_|g' "$file"
  # Constant/variable names that have PAPERCLIP in them (but not the ones we want to keep)
  sed -i '' 's|STAPLER_SKILL_ROOT_RELATIVE_CANDIDATES|STAPLER_SKILL_ROOT_RELATIVE_CANDIDATES|g' "$file"
}

# Take theirs for a file and apply substitutions
take_theirs() {
  local file="$1"
  git show ":3:$file" | sed \
    -e 's|@stapler/|@stapler/|g' \
    -e 's|STAPLER_|STAPLER_|g' \
    > "$file"
}

# Take theirs for a file, apply subs, and git add
resolve() {
  local file="$1"
  echo "Resolving: $file"
  git show ":3:$file" | sed \
    -e 's|@stapler/|@stapler/|g' \
    -e 's|STAPLER_|STAPLER_|g' \
    > "$REPO_ROOT/$file"
  git add "$REPO_ROOT/$file"
}

echo "Done"
