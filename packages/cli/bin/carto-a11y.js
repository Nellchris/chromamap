#!/usr/bin/env node
// Plain JS on purpose: this is the only file that touches Node globals, which
// keeps @types/node out of the dependency list while the scaffold has none.
import { run } from '../dist/index.js';

const { output, exitCode } = run(process.argv.slice(2));
process.stdout.write(output);
process.exitCode = exitCode;
