'use strict';

const fs = require('fs');
const path = require('path');
const Diff = require('diff');

/**
 * Generates a unified diff comparing an existing file's contents
 * to the proposed new contents.
 * 
 * @param {string} targetPath - The absolute or relative path to the file.
 * @param {string} newContent - The proposed new content.
 * @returns {object|null} - { diffText, linesAdded, linesRemoved } or null if not applicable.
 */
function generateDiff(targetPath, newContent) {
  try {
    const resolvedPath = path.resolve(targetPath);
    let oldContent = '';
    
    // Check if file exists. If it doesn't, oldContent remains empty.
    if (fs.existsSync(resolvedPath)) {
      // Avoid reading huge binary files or excessively large text files
      const stats = fs.statSync(resolvedPath);
      if (stats.size > 2 * 1024 * 1024) { // 2MB limit
        return { diffText: 'File is too large to display diff.', linesAdded: 0, linesRemoved: 0 };
      }
      oldContent = fs.readFileSync(resolvedPath, 'utf8');
    }

    // Generate diff
    const diffResult = Diff.createPatch(
      path.basename(resolvedPath),
      oldContent,
      newContent,
      'Old',
      'New',
      { context: 3 } // number of context lines around changes
    );

    // Calculate line changes
    const changes = Diff.diffLines(oldContent, newContent);
    let linesAdded = 0;
    let linesRemoved = 0;
    changes.forEach(part => {
      if (part.added) linesAdded += part.count;
      if (part.removed) linesRemoved += part.count;
    });

    return {
      diffText: diffResult,
      linesAdded,
      linesRemoved
    };

  } catch (err) {
    console.error(`[AG Diff] Error generating diff for ${targetPath}:`, err.message);
    return null;
  }
}

module.exports = { generateDiff };
