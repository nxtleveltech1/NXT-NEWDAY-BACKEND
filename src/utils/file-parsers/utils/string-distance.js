// Levenshtein distance algorithm for string similarity
export function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  
  // Create a 2D array for dynamic programming
  const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
  
  // Initialize first row and column
  for (let i = 0; i <= len1; i++) {
    matrix[i][0] = i;
  }
  
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
  // Fill the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  return matrix[len1][len2];
}

// Calculate similarity ratio (0 to 1)
export function stringSimilarity(str1, str2) {
  const distance = levenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);
  
  if (maxLen === 0) return 1;
  
  return 1 - (distance / maxLen);
}

// Jaro-Winkler distance for better short string matching
export function jaroWinklerDistance(s1, s2) {
  const jaroDistance = jaro(s1, s2);
  
  if (jaroDistance < 0.7) {
    return jaroDistance;
  }
  
  // Find common prefix up to 4 characters
  let prefix = 0;
  for (let i = 0; i < Math.min(s1.length, s2.length, 4); i++) {
    if (s1[i] === s2[i]) {
      prefix++;
    } else {
      break;
    }
  }
  
  return jaroDistance + prefix * 0.1 * (1 - jaroDistance);
}

// Jaro distance helper function
function jaro(s1, s2) {
  if (s1 === s2) return 1;
  
  const len1 = s1.length;
  const len2 = s2.length;
  
  if (len1 === 0 || len2 === 0) return 0;
  
  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  
  let matches = 0;
  let transpositions = 0;
  
  // Find matches
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  
  if (matches === 0) return 0;
  
  // Count transpositions
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    
    while (!s2Matches[k]) k++;
    
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  
  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
}

// Dice coefficient for set-based similarity
export function diceCoefficient(str1, str2, n = 2) {
  const ngrams1 = getNGrams(str1, n);
  const ngrams2 = getNGrams(str2, n);
  
  if (ngrams1.size === 0 && ngrams2.size === 0) return 1;
  if (ngrams1.size === 0 || ngrams2.size === 0) return 0;
  
  let intersection = 0;
  for (const ngram of ngrams1) {
    if (ngrams2.has(ngram)) {
      intersection++;
    }
  }
  
  return (2 * intersection) / (ngrams1.size + ngrams2.size);
}

// Get n-grams from string
function getNGrams(str, n) {
  const ngrams = new Set();
  
  if (str.length < n) {
    ngrams.add(str);
    return ngrams;
  }
  
  for (let i = 0; i <= str.length - n; i++) {
    ngrams.add(str.slice(i, i + n));
  }
  
  return ngrams;
}

// Find best match from a list of candidates
export function findBestMatch(target, candidates, threshold = 0.6) {
  let bestMatch = null;
  let bestScore = 0;
  
  for (const candidate of candidates) {
    const score = Math.max(
      stringSimilarity(target, candidate),
      jaroWinklerDistance(target, candidate),
      diceCoefficient(target, candidate)
    );
    
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestMatch = candidate;
    }
  }
  
  return {
    match: bestMatch,
    score: bestScore,
    found: bestMatch !== null
  };
}