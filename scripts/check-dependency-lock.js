#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const lockPath = path.join(root, 'package-lock.json');
const pkgPath = path.join(root, 'package.json');

if (!fs.existsSync(lockPath)) {
  console.error('ERROR: package-lock.json is missing. Generate it with: npm install --package-lock-only');
  process.exit(1);
}

let pkg;
let lock;
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
} catch (err) {
  console.error(`ERROR: Unable to read dependency manifests: ${err.message}`);
  process.exit(1);
}

if (lock.lockfileVersion !== 3) {
  console.error(`ERROR: Expected npm lockfileVersion 3, found ${lock.lockfileVersion}. Regenerate with npm install.`);
  process.exit(1);
}

const rootPackage = lock.packages && lock.packages[''];
if (!rootPackage) {
  console.error('ERROR: package-lock.json does not contain the root package entry.');
  process.exit(1);
}

const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
for (const section of sections) {
  const expected = pkg[section] || {};
  const actual = rootPackage[section] || {};
  for (const name of Object.keys(expected)) {
    if (!Object.prototype.hasOwnProperty.call(actual, name)) {
      console.error(`ERROR: package-lock.json is missing root dependency ${name} from ${section}.`);
      process.exit(1);
    }
  }
}

console.log('Dependency lockfile check passed.');
