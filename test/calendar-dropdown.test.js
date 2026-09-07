'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('.cal-dropdown is positioned fixed, not absolute, so it is not clipped by an overflow:auto modal', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
  const rule = css.match(/\.cal-dropdown\s*\{[^}]*\}/)[0];

  assert.match(rule, /position:\s*fixed/);
  assert.doesNotMatch(rule, /position:\s*absolute/);
  assert.doesNotMatch(rule, /top:\s*calc\(100%/);
});
