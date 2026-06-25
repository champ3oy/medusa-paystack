module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.[jt]sx?$": ["@swc/jest"],
  },
  testMatch: ["**/src/**/*.test.ts"],
};
