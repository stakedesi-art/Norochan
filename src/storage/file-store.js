'use strict';
// JSON file storage driver. The whole dataset lives in memory in `db` and is rewritten
// atomically (tmp file + rename) on every save. Fine for one instance.
const fs = require('fs');

function createFileStore(filePath) {
  // Stable object: modules keep a reference to it, so load() replaces its contents in place.
  const db = {};

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const key of Object.keys(db)) delete db[key];
      Object.assign(db, parsed);
    } catch (err) {
      if (err.code === 'ENOENT') return;
      console.error(`Cannot read ${filePath}: ${err.message}. Fix or move the file, then restart.`);
      process.exit(1); // never overwrite a file we could not parse
    }
  }

  function save() {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    // Windows can briefly lock the target (antivirus, indexer); retry instead of failing the request.
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(tmp, filePath); return; }
      catch (err) {
        if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
      }
    }
  }

  return { driver: 'file', location: filePath, db, load, save };
}

module.exports = { createFileStore };
