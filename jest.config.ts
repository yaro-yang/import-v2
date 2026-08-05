import type { Config } from "jest";
import nextJest from "next/jest";

const createJestConfig = nextJest({ dir: "./" });

const config: Config = {
  setupFilesAfterSetup: ["<rootDir>/jest.setup.ts"],
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  clearMocks: true,
};

export default createJestConfig(config);
