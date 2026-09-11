'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_ORDER = ['to_invite', 'invited', 'confirmed', 'attended', 'declined', 'did_not_show'];

test('board columns render in the order To Invite, Invited, Confirmed, Attended, Declined, Did Not Show', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const statusesBlock = appJs.match(/const STATUSES = \[([\s\S]*?)\];/)[1];
  const keys = [...statusesBlock.matchAll(/key:\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, EXPECTED_ORDER);
});
