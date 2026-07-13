/**
 * Computes the Levenshtein distance between two strings.
 * @param {string} a 
 * @param {string} b 
 * @returns {number} Distance
 */
function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1  // deletion
                    )
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Finds the item in the array that best matches the query using Levenshtein distance.
 * @param {string} query - The search query
 * @param {Array} items - Array of items to search through
 * @param {Function} keyFn - Function to extract the string to compare from an item
 * @returns {Object|null} The best matching item or null if empty
 */
function findBestMatch(query, items, keyFn) {
    if (!items || items.length === 0) return null;
    if (!query) return items[0];

    const lowerQuery = query.toLowerCase();
    
    let bestMatch = items[0];
    let minDistance = Infinity;

    for (const item of items) {
        const itemString = keyFn(item).toLowerCase();
        
        // Exact substring match check first to highly weigh natural queries
        if (itemString.includes(lowerQuery) || lowerQuery.includes(itemString)) {
            // Distance of 0 for direct substring hits (or small penalty based on length difference)
            const distance = Math.abs(itemString.length - lowerQuery.length);
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = item;
            }
        } else {
            const distance = levenshteinDistance(lowerQuery, itemString);
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = item;
            }
        }
    }

    return bestMatch;
}

module.exports = {
    levenshteinDistance,
    findBestMatch
};
