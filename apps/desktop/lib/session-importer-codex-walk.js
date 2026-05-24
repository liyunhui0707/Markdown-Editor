/* Phase A.2 — date-segmented source-tree walker for the Codex importer.
   Ported verbatim from Local-Web-Server/tools/import-codex.js (commit 4bb2eb3)
   lines 100–225. ESM → CommonJS.

   Walks canonicalSourceRoot/YYYY/MM/DD/rollout-*.jsonl. Skips entries that
   fail the allowlist regexes, symlinked components at any level, and
   non-directory components. Returns identified candidate files plus running
   skipped/errors counters. */

'use strict';

const path = require('node:path');

const {
  YEAR_RE,
  MONTH_RE,
  DAY_RE,
  ROLLOUT_FILE_RE,
} = require('./session-importer-codex-utils');

async function walkSourceTree(canonicalSourceRoot, _fs) {
  const candidates = [];
  let skipped = 0;
  let errors = 0;

  let yearEntries;
  try {
    yearEntries = await _fs.readdir(canonicalSourceRoot);
  } catch {
    return { candidates, skipped, errors: errors + 1 };
  }
  yearEntries.sort();
  for (const year of yearEntries) {
    if (!YEAR_RE.test(year)) {
      skipped += 1;
      continue;
    }
    const yearPath = path.join(canonicalSourceRoot, year);
    let yearLst;
    try {
      yearLst = await _fs.lstat(yearPath);
    } catch {
      errors += 1;
      continue;
    }
    if (yearLst.isSymbolicLink() || !yearLst.isDirectory()) {
      skipped += 1;
      continue;
    }

    let monthEntries;
    try {
      monthEntries = await _fs.readdir(yearPath);
    } catch {
      errors += 1;
      continue;
    }
    monthEntries.sort();
    for (const month of monthEntries) {
      if (!MONTH_RE.test(month)) {
        skipped += 1;
        continue;
      }
      const monthPath = path.join(yearPath, month);
      let monthLst;
      try {
        monthLst = await _fs.lstat(monthPath);
      } catch {
        errors += 1;
        continue;
      }
      if (monthLst.isSymbolicLink() || !monthLst.isDirectory()) {
        skipped += 1;
        continue;
      }

      let dayEntries;
      try {
        dayEntries = await _fs.readdir(monthPath);
      } catch {
        errors += 1;
        continue;
      }
      dayEntries.sort();
      for (const day of dayEntries) {
        if (!DAY_RE.test(day)) {
          skipped += 1;
          continue;
        }
        const dayPath = path.join(monthPath, day);
        let dayLst;
        try {
          dayLst = await _fs.lstat(dayPath);
        } catch {
          errors += 1;
          continue;
        }
        if (dayLst.isSymbolicLink() || !dayLst.isDirectory()) {
          skipped += 1;
          continue;
        }

        let fileEntries;
        try {
          fileEntries = await _fs.readdir(dayPath);
        } catch {
          errors += 1;
          continue;
        }
        fileEntries.sort();
        for (const fileName of fileEntries) {
          if (!ROLLOUT_FILE_RE.test(fileName)) {
            skipped += 1;
            continue;
          }
          const fileAbs = path.join(dayPath, fileName);
          let fileLst;
          try {
            fileLst = await _fs.lstat(fileAbs);
          } catch {
            errors += 1;
            continue;
          }
          if (fileLst.isSymbolicLink() || !fileLst.isFile()) {
            skipped += 1;
            continue;
          }
          candidates.push({
            fileAbs,
            fileName,
            year,
            month,
            day,
            lst: fileLst,
          });
        }
      }
    }
  }

  return { candidates, skipped, errors };
}

module.exports = { walkSourceTree };
