#!/usr/bin/env node
// Plain JS on purpose: this is the only file that touches Node globals, which
// keeps @types/node out of the dependency list and keeps src/ portable.
import { readFileSync, writeFileSync } from 'node:fs';

import { run } from '../dist/index.js';

const io = {
  readTextFile: (path) => readFileSync(path, 'utf8'),
  writeTextFile: (path, contents) => writeFileSync(path, contents, 'utf8'),
};

const { output, exitCode } = run(process.argv.slice(2), io);
process.stdout.write(output);
process.exitCode = exitCode;
