const fs = require('fs');
const { execSync } = require('child_process');

console.log('[AG] Compiling massive command dictionary from macOS internals...');
const db = {};

try {
  // Extract ALL manuals from the macOS core
  const output = execSync('man -k . 2>/dev/null', { maxBuffer: 1024 * 1024 * 10 }).toString();
  const lines = output.split('\n');
  
  for (const line of lines) {
    if (line.includes(' - ')) {
      const parts = line.split(' - ');
      let cmdPart = parts[0].trim();
      let description = parts.slice(1).join(' - ').trim();
      
      // Clean up "lsof(8), lsof(1)" to just "lsof"
      cmdPart = cmdPart.split(',')[0].replace(/\(\d[a-z]*\)/g, '').trim();
      
      // Only keep actual single word commands to avoid clutter
      if (cmdPart && !cmdPart.includes(' ') && description) {
        db[cmdPart] = description;
      }
    }
  }
  
  // Hardcode specific overrides for missing or critical macOS tools
  db['lsof'] = 'list open files and network ports';
  db['tar'] = 'manipulate tape archives (compress/extract files)';
  db['awk'] = 'pattern-directed scanning and processing language';
  db['sed'] = 'stream editor for filtering and transforming text';
  db['dscl'] = 'Directory Service command line utility';
  db['pbcopy'] = 'copy data to the macOS clipboard';
  db['pbpaste'] = 'paste data from the macOS clipboard';
  db['defaults'] = 'access the macOS user defaults system';
  
  fs.writeFileSync('commands-db.json', JSON.stringify(db, null, 2));
  console.log(`[AG] Successfully compiled ${Object.keys(db).length} commands into commands-db.json!`);
} catch (e) {
  console.error('[AG] Failed to build dictionary:', e.message);
}
