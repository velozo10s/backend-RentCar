/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // No transform needed; we run pure ESM.
  transform: {},
  // Do NOT set extensionsToTreatAsEsm for ".js" — ESM is inferred from package.json.
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.js'],
  verbose: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  // Optional: keep tests under /tests
  roots: ['<rootDir>/tests']
};
