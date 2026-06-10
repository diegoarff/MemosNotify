/** Escape a string so it can be embedded literally inside a `RegExp`. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-tag match: `#remind` matches; `#reminder` and the nested `#remind/sub` do not. Excluding
// tag characters (\w, `-`, `/`) on both sides — rather than requiring whitespace — lets a tag sit
// flush against punctuation like "(#remind)" while never matching a fragment of a longer tag.
export function contentHasTag(content: string, tag: string): boolean {
  return new RegExp(String.raw`(?<![\w/-])#${escapeRegExp(tag)}(?![\w/-])`, "i").test(content);
}
