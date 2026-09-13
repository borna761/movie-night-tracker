'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('watchlist cards are wide enough to read the full overview text', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

  const gridRule = css.match(/\.wl-list,\s*#wl-list\s*\{[^}]*\}/)[0];
  const minWidthMatch = gridRule.match(/minmax\((\d+)px/);
  assert.ok(minWidthMatch, 'grid should use a minmax() column width');
  assert.ok(Number(minWidthMatch[1]) >= 260, 'watchlist card min width should be at least 260px');

  const overviewRule = css.match(/\.wl-card \.wl-overview\s*\{[^}]*\}/)[0];
  assert.doesNotMatch(overviewRule, /-webkit-line-clamp/, 'overview text should not be clamped so the full text is readable');
});
