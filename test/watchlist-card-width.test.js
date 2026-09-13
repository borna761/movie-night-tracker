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
  const minWidth = Number(minWidthMatch[1]);
  assert.ok(minWidth >= 200 && minWidth <= 230, 'watchlist card min width should be between 200-230px');

  const overviewRule = css.match(/\.wl-card \.wl-overview\s*\{[^}]*\}/)[0];
  const clampMatch = overviewRule.match(/-webkit-line-clamp:\s*(\d+)/);
  assert.ok(clampMatch, 'overview text should be clamped to a fixed number of lines');
  assert.equal(Number(clampMatch[1]), 5, 'overview should be clamped at 5 lines');
});

test('the Remove button stays pinned to the bottom of the card regardless of overview length', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

  const cardRule = css.match(/\.wl-card\s*\{[^}]*\}/)[0];
  assert.match(cardRule, /display:\s*flex/, '.wl-card should be a flex container so its rows can stretch');
  assert.match(cardRule, /flex-direction:\s*column/, '.wl-card should stack its content vertically');

  const infoRule = css.match(/\.wl-card \.wl-info\s*\{[^}]*\}/)[0];
  assert.match(infoRule, /flex:\s*1/, '.wl-info should grow to fill remaining space, pushing the actions row to the bottom');
});
