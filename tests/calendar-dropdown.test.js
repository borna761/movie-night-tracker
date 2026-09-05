/**
 * @jest-environment jsdom
 * @jest-environment-options {"runScripts": "dangerously"}
 */
'use strict';

const fs = require('fs');
const path = require('path');

function loadApp() {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  document.documentElement.innerHTML = html;
  window.fetch = () => Promise.resolve({ json: () => Promise.resolve([]) });
  const script = document.createElement('script');
  script.textContent = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  document.body.appendChild(script);
}

describe('calOpen positioning', () => {
  test('positions the dropdown as fixed, anchored to the date field via getBoundingClientRect', () => {
    loadApp();

    const display = document.getElementById('night-date-display');
    display.getBoundingClientRect = () => ({
      top: 100, bottom: 130, left: 40, right: 200, width: 160, height: 30,
    });

    window.calOpen(new Date(2026, 0, 15));

    const dropdown = document.getElementById('cal-dropdown');
    expect(dropdown.classList.contains('hidden')).toBe(false);
    expect(dropdown.style.top).toBe('136px');
    expect(dropdown.style.left).toBe('40px');
  });
});

describe('.cal-dropdown CSS', () => {
  test('is positioned fixed, not absolute, so it is not clipped by an overflow:auto modal', () => {
    const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
    const rule = css.match(/\.cal-dropdown\s*\{[^}]*\}/)[0];

    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).not.toMatch(/position:\s*absolute/);
    expect(rule).not.toMatch(/top:\s*calc\(100%/);
  });
});
