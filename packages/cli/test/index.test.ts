import { describe, expect, it } from 'vitest';

import { run } from '../src/index.js';

describe('run: contrast', () => {
  it('reports the ratio for two hex colours', () => {
    expect(run(['contrast', '#000000', '#ffffff'])).toEqual({
      output: '21.00:1\n',
      exitCode: 0,
    });
    expect(run(['contrast', '#767676', '#ffffff']).output).toBe('4.54:1\n');
  });

  it('accepts short hex, with or without the hash', () => {
    expect(run(['contrast', '#000', '#fff']).output).toBe('21.00:1\n');
    expect(run(['contrast', '000000', 'ffffff']).output).toBe('21.00:1\n');
  });

  it('accepts CSS colour names, now that core does the parsing', () => {
    expect(run(['contrast', 'black', 'white']).output).toBe('21.00:1\n');
    expect(run(['contrast', 'REBECCAPURPLE', 'white']).output).toBe(
      run(['contrast', '#663399', '#ffffff']).output,
    );
  });

  it('accepts rgb() and rgba()', () => {
    expect(run(['contrast', 'rgb(0, 0, 0)', 'rgb(255, 255, 255)']).output).toBe('21.00:1\n');
    expect(run(['contrast', 'rgba(0, 0, 0, 0.5)', 'white']).output).toBe('21.00:1\n');
  });

  it('is order-independent', () => {
    expect(run(['contrast', 'white', 'black']).output).toBe(
      run(['contrast', 'black', 'white']).output,
    );
  });

  it('reports 1:1 for a colour against itself', () => {
    expect(run(['contrast', 'red', 'red']).output).toBe('1.00:1\n');
  });

  it('fails with the parser message for an unparseable colour', () => {
    const result = run(['contrast', 'nope', '#ffffff']);
    expect(result.exitCode).toBe(2);
    expect(result.output).toMatch(/^error: cannot parse colour: nope/);
  });

  it('fails when a colour is missing', () => {
    const result = run(['contrast', '#ffffff']);
    expect(result.exitCode).toBe(2);
    expect(result.output).toMatch(/needs two colours/);
  });
});

describe('run: usage', () => {
  it('prints usage for no arguments and for the help flags', () => {
    for (const argv of [[], ['--help'], ['-h']]) {
      const result = run(argv);
      expect(result.exitCode, JSON.stringify(argv)).toBe(0);
      expect(result.output, JSON.stringify(argv)).toMatch(/^carto-a11y/);
    }
  });

  it('documents the colour formats it accepts', () => {
    expect(run(['--help']).output).toMatch(/CSS colour name/);
  });

  it('rejects an unknown command with usage', () => {
    const result = run(['wat']);
    expect(result.exitCode).toBe(2);
    expect(result.output).toMatch(/unknown command: wat/);
    expect(result.output).toMatch(/Usage:/);
  });
});
