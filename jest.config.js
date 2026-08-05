/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          esModuleInterop: true,
          isolatedModules: true,
        },
      },
    ],
  },
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  clearMocks: true,
};

module.exports = config;
