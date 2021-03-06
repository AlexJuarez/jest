#!/usr/bin/env node
/**
 * Copyright (c) 2014, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

'use strict';

const fs = require('graceful-fs');
const optimist = require('optimist');
const path = require('path');

/**
 * Takes a description string, puts it on the next line, indents it, and makes
 * sure it wraps without exceeding 80chars
 */
function _wrapDesc(desc) {
  const indent = '\n      ';
  return indent + desc.split(' ').reduce(function(wrappedDesc, word) {
    const lastLineIdx = wrappedDesc.length - 1;
    const lastLine = wrappedDesc[lastLineIdx];

    const appendedLastLine = lastLine === '' ? word : (lastLine + ' ' + word);

    if (appendedLastLine.length > 80) {
      wrappedDesc.push(word);
    } else {
      wrappedDesc[lastLineIdx] = appendedLastLine;
    }

    return wrappedDesc;
  }, ['']).join(indent);
}

const argv = optimist
  .usage('Usage: $0 [--config=<pathToConfigFile>] [TestPathRegExp]')
  .options({
    config: {
      alias: 'c',
      description: _wrapDesc(
        'The path to a jest config file specifying how to find and execute ' +
        'tests. If no rootDir is set in the config, the current directory ' +
        'is assumed to be the rootDir for the project.'
      ),
      type: 'string',
    },
    coverage: {
      description: _wrapDesc(
        'Indicates that test coverage information should be collected and ' +
        'reported in the output.'
      ),
      type: 'boolean',
    },
    maxWorkers: {
      alias: 'w',
      description: _wrapDesc(
        'Specifies the maximum number of workers the worker-pool will spawn ' +
        'for running tests. This defaults to the number of the cores ' +
        'available on your machine. (its usually best not to override this ' +
        'default)'
      ),
      type: 'string', // no, optimist -- its a number.. :(
    },
    onlyChanged: {
      alias: 'o',
      description: _wrapDesc(
        'Attempts to identify which tests to run based on which files have ' +
        'changed in the current repository. Only works if you\'re running ' +
        'tests in a git repository at the moment.'
      ),
      type: 'boolean',
    },
    runInBand: {
      alias: 'i',
      description: _wrapDesc(
        'Run all tests serially in the current process (rather than creating ' +
        'a worker pool of child processes that run tests). This is sometimes ' +
        'useful for debugging, but such use cases are pretty rare.'
      ),
      type: 'boolean',
    },
    testEnvData: {
      description: _wrapDesc(
        'A JSON object (string) that specifies data that will be made ' +
        'available in the test environment (via jest.getEnvData())'
      ),
      type: 'string',
    },
    testPathPattern: {
      description: _wrapDesc(
        'A regexp pattern string that is matched against all tests ' +
        'paths before executing the test.'
      ),
      type: 'string',
    },
    version: {
      alias: 'v',
      description: _wrapDesc('Print the version and exit'),
      type: 'boolean',
    },
    noHighlight: {
      description: _wrapDesc(
        'Disables test results output highlighting'
      ),
      type: 'boolean',
    },
    noStackTrace: {
      description: _wrapDesc(
        'Disables stack trace in test results output'
      ),
      type: 'boolean',
    },
    verbose: {
      description: _wrapDesc(
        'Display individual test results with the test suite hierarchy.'
      ),
      type: 'boolean',
    },
    watch: {
      description: _wrapDesc(
        'Watch files for changes and rerun tests related to changed files ' +
        'and directories. Works with `--onlyChanged` to only run the ' +
        'affected tests.'
      ),
      type: 'boolean',
    },
    watchExtensions: {
      description: _wrapDesc(
        'Comma separated list of file extensions to watch, defaults to js.'
      ),
      type: 'string',
    },
    bail: {
      alias: 'b',
      description: _wrapDesc(
        'Exit the test suite immediately upon the first failing test.'
      ),
      type: 'boolean',
    },
    useStderr: {
      description: _wrapDesc(
        'Divert all output to stderr.'
      ),
      type: 'boolean',
    },
    cache: {
      default: true,
      description: _wrapDesc(
        'Whether to use the preprocessor cache. Disable the cache using ' +
        '--no-cache.'
      ),
      type: 'boolean',
    },
    json: {
      description: _wrapDesc(
        'Prints the test results in JSON. This mode will send all ' +
        'other test output and user messages to stderr.'
      ),
      type: 'boolean',
    },
    testRunner: {
      description: _wrapDesc(
        'Allows to specify a custom test runner. Jest ships with Jasmine ' +
        '1 and 2 which can be enabled by setting this option to ' +
        '`jasmine1` or `jasmine2`. The default is `jasmine2`. A path to a ' +
        'custom test runner can be provided: `<rootDir>/path/to/testRunner.js`.'
      ),
      type: 'string',
    },
    logHeapUsage: {
      description: _wrapDesc(
        'Logs the heap usage after every test. Useful to debug memory ' +
        'leaks. Use together with `--runInBand` and `--expose-gc` in node.'
      ),
      type: 'boolean',
    },
    watchman: {
      default: true,
      description: _wrapDesc(
        'Whether to use watchman for file crawling. Disable using ' +
        '--no-watchman.'
      ),
      type: 'boolean',
    },
  })
  .check(function(argv) {
    if (argv.runInBand && argv.hasOwnProperty('maxWorkers')) {
      throw new Error(
        'Both --runInBand and --maxWorkers were specified, but these two ' +
        'options do not make sense together. Which is it?'
      );
    }

    if (argv.onlyChanged && argv._.length > 0) {
      throw new Error(
        'Both --onlyChanged and a path pattern were specified, but these two ' +
        'options do not make sense together. Which is it? Do you want to run ' +
        'tests for changed files? Or for a specific set of files?'
      );
    }

    if (argv.watchExtensions && argv.watch === undefined) {
      throw new Error(
        '--watchExtensions can only be specified together with --watch.'
      );
    }

    if (argv.testEnvData) {
      argv.testEnvData = JSON.parse(argv.testEnvData);
    }
  })
  .argv;

function runJest() {
  if (argv.help) {
    optimist.showHelp();

    process.on('exit', function() {
      process.exit(1);
    });

    return;
  }

  const cwd = process.cwd();

  // Is the cwd somewhere within an npm package?
  let cwdPackageRoot = cwd;
  while (!fs.existsSync(path.join(cwdPackageRoot, 'package.json'))) {
    if (cwdPackageRoot === '/' || cwdPackageRoot.match(/^[A-Z]:\\/)) {
      cwdPackageRoot = cwd;
      break;
    }
    cwdPackageRoot = path.resolve(cwdPackageRoot, '..');
  }

  // Is there a package.json at our cwdPackageRoot that indicates that there
  // should be a version of Jest installed?
  const cwdPkgJsonPath = path.join(cwdPackageRoot, 'package.json');

  // Is there a version of Jest installed at our cwdPackageRoot?
  const cwdJestBinPath = path.join(cwdPackageRoot, 'node_modules/jest-cli');

  // Get a jest instance
  let jest;

  if (fs.existsSync(cwdJestBinPath)) {
    // If a version of Jest was found installed in the CWD package, use that.
    jest = require(cwdJestBinPath);

    if (!jest.runCLI) {
      console.error(
        'This project requires an older version of Jest than what you have ' +
        'installed globally.\n' +
        'Please upgrade this project past Jest version 0.1.5'
      );

      process.on('exit', function() {
        process.exit(1);
      });

      return;
    }
  } else {
    // Otherwise, load this version of Jest.
    jest = require('../');

    // If a package.json was found in the CWD package indicating a specific
    // version of Jest to be used, bail out and ask the user to `npm install`
    // first
    if (fs.existsSync(cwdPkgJsonPath)) {
      const cwdPkgJson = require(cwdPkgJsonPath);
      const cwdPkgDeps = cwdPkgJson.dependencies;
      const cwdPkgDevDeps = cwdPkgJson.devDependencies;

      if (cwdPkgDeps && cwdPkgDeps['jest-cli']
          || cwdPkgDevDeps && cwdPkgDevDeps['jest-cli']) {
        console.error(
          'Please run `npm install` to use the version of Jest intended for ' +
          'this project.'
        );

        process.on('exit', function() {
          process.exit(1);
        });

        return;
      }
    }
  }

  jest.runCLI(argv, cwdPackageRoot, function(success) {
    process.on('exit', function() {
      process.exit(success ? 0 : 1);
    });
  });
}

if (process.env.NODE_ENV == null) {
  process.env.NODE_ENV = 'test';
}

runJest();
