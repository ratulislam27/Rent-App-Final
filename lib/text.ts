export function formatTitleCase(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en")
    .replace(/(^|[^\p{L}\p{N}])\p{L}/gu, (match) => match.toLocaleUpperCase("en"))
    .replace(/\p{N}\p{L}+/gu, (match) => match.toLocaleUpperCase("en"));
}
