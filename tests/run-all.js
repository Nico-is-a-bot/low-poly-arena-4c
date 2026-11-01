// Runs every test file and reports one overall result.
const { spawnSync } = require('child_process');
const path = require('path');
const files = ['physics.test.js', 'map.test.js', 'combat.test.js', 'weapons.test.js', 'grenades.test.js', 'lean.test.js', 'abilities.test.js', 'zilla.test.js', 'ws.test.js', 'server.test.js'];
let bad = 0;
for (const f of files) {
  console.log('\n=== ' + f + ' ===');
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log('\n' + (bad === 0 ? 'ALL TESTS PASSED' : bad + ' TEST FILE(S) FAILED'));
process.exit(bad === 0 ? 0 : 1);
