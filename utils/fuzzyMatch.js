import levenshtein from "levenshtein-edit-distance";

export function fuzzyMatch(input, knownCommands) {
  let bestMatch = null;
  let minDistance = Infinity;

  for (const known of knownCommands) {
    const dist = levenshtein(input, known);
    if (dist < minDistance && dist <= 3) {
      minDistance = dist;
      bestMatch = known;
    }
  }

  return bestMatch;
}
