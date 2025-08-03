module.exports = {
  testEnvironment: 'node',
  transform: {},
  moduleNameMapper: {},
  testMatch: ['<rootDir>/src/services/__tests__/niledb-integration.service.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/__tests__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 30000,
  setupFiles: ['<rootDir>/jest.setup.cjs'],
};