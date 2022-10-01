export default {
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    "^.+\\.tsx?$": "@zebreus/resolve-tspaths/jest",
  },
  coverageThreshold: {
    global: {
      statements: 95,
    },
  },
}
