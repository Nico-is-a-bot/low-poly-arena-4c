// Tiny test helper (no dependencies).
let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('  ok   ' + name);
  } else {
    failed++;
    failures.push(name);
    console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : ''));
  }
}

function near(name, actual, expected, tolerance) {
  const ok = Math.abs(actual - expected) <= tolerance;
  check(name, ok, 'got ' + actual.toFixed(4) + ', wanted ' + expected + ' (+-' + tolerance + ')');
}

function between(name, actual, lo, hi) {
  check(name, actual >= lo && actual <= hi, 'got ' + actual.toFixed(4) + ', wanted ' + lo + ' to ' + hi);
}

function section(title) {
  console.log('\n' + title);
}

function summary(label) {
  console.log('\n' + label + ': ' + passed + ' passed, ' + failed + ' failed');
  return failed === 0;
}

module.exports = { check, near, between, section, summary };
