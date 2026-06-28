module.exports = {
  testEnvironment: 'jsdom',
  preset: 'ts-jest',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.spec.ts', '**/*.spec.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        "jsx": "react-jsx",
        "module": "commonjs",
        "esModuleInterop": true,
        "target": "ES2022",
        "skipLibCheck": true
      }
    }]
  },
  moduleNameMapper: {
    '\\.(css|less|scss)$': '<rootDir>/tests/mocks/styleMock.ts'
  }
}
