export default {
  testEnvironment: 'node',
  transform: {},
  moduleNameMapper: {},
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  setupFilesAfterEnv: ['./tests/setup.js'],
  verbose: true,
  collectCoverageFrom: ['src/**/*.js', '!src/**/index.js'],
};
