#!/usr/bin/env bash
# Publish a dev state as ONE release commit on the public main, then tag it (tag fires release.yml).
# Usage: scripts/release-public.sh "<one-line summary>" [dev-commit, default HEAD]
# The version comes from package.json of that commit, so run `npm version` on dev first.
set -euo pipefail
pub=origin
summary="${1:?summary required}"
src=$(git rev-parse --verify "${2:-HEAD}^{commit}")
ver=$(git show "$src:package.json" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')
tag="v$ver"

git fetch -q "$pub" main
git ls-remote --exit-code --tags "$pub" "refs/tags/$tag" >/dev/null && { echo "tag $tag already public" >&2; exit 1; }
base=$(git rev-parse "$pub/main")

# The tree copy below replaces the public tree wholesale. Anything merged publicly since the
# last release (Dependabot, outside PRs) would vanish, so public main must equal a dev state.
last=$(git log -1 --format=%B "$base" | sed -n 's/^Source: //p')
[ -n "$last" ] || last=$base # first release: public main is still a plain dev commit
if ! git diff --quiet "$last" "$base"; then
  echo "public main has changes that are not in dev; cherry-pick them onto dev first:" >&2
  git diff --stat "$last" "$base" >&2
  exit 1
fi
git merge-base --is-ancestor "$last" "$src" || { echo "$last is not in the history of $src" >&2; exit 1; }

c=$(git commit-tree "$src^{tree}" -p "$base" -m "Release $ver: $summary" -m "Source: $src")
echo "release commit $c  (tree of $src, parent $base)"
git diff --stat "$base" "$c" | tail -1
read -rp "push to $pub/main and tag $tag? [y/N] " ok
[ "$ok" = y ] || { echo "aborted, nothing pushed"; exit 1; }

git push "$pub" "$c:refs/heads/main"
git tag -a -f "$tag" -m "Release $ver" "$c"
git push "$pub" "refs/tags/$tag"
