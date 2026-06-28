/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        "module": "commonjs",
        "esModuleInterop": true,
        "target": "ES2022",
        "skipLibCheck": true,
        "jsx": "react-jsx",
        "moduleResolution": "node",
        "baseUrl": ".",
        "paths": {
          "@shared/*": ["src/shared/*"],
          "@agent/*": ["src/agent/*"],
          "@tools/*": ["src/tools/*"],
          "@storage/*": ["src/storage/*"]
        }
      }
    }]
  },
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@agent/(.*)$': '<rootDir>/src/agent/$1',
    '^@tools/(.*)$': '<rootDir>/src/tools/$1',
    '^@storage/(.*)$': '<rootDir>/src/storage/$1',
    '^electron$': '<rootDir>/tests/mocks/electron.ts',
    '^better-sqlite3$': '<rootDir>/tests/mocks/better-sqlite3.ts',
    '\\.(css|less|scss)$': '<rootDir>/tests/mocks/styleMock.ts'
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/'],
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', {
          tsconfig: {
            "module": "commonjs",
            "esModuleInterop": true,
            "target": "ES2022",
            "skipLibCheck": true,
            "moduleResolution": "node",
            "baseUrl": ".",
            "paths": {
              "@shared/*": ["src/shared/*"],
              "@agent/*": ["src/agent/*"],
              "@tools/*": ["src/tools/*"],
              "@storage/*": ["src/storage/*"]
            }
          }
        }]
      },
      moduleNameMapper: {
        '^@shared/(.*)$': '<rootDir>/src/shared/$1',
        '^@agent/(.*)$': '<rootDir>/src/agent/$1',
        '^@tools/(.*)$': '<rootDir>/src/tools/$1',
        '^@storage/(.*)$': '<rootDir>/src/storage/$1',
        '^electron$': '<rootDir>/tests/mocks/electron.ts',
        '^better-sqlite3$': '<rootDir>/tests/mocks/better-sqlite3.ts'
      }
    },
    {
      displayName: 'dom',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/tests/*.test.tsx'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', {
          tsconfig: {
            "module": "commonjs",
            "esModuleInterop": true,
            "target": "ES2022",
            "skipLibCheck": true,
            "jsx": "react-jsx",
            "moduleResolution": "node",
            "baseUrl": ".",
            "paths": {
              "@shared/*": ["src/shared/*"],
              "@agent/*": ["src/agent/*"],
              "@tools/*": ["src/tools/*"],
              "@storage/*": ["src/storage/*"]
            }
          }
        }]
      },
      moduleNameMapper: {
        '^@shared/(.*)$': '<rootDir>/src/shared/$1',
        '^@agent/(.*)$': '<rootDir>/src/agent/$1',
        '^@tools/(.*)$': '<rootDir>/src/tools/$1',
        '^@storage/(.*)$': '<rootDir>/src/storage/$1',
        '^electron$': '<rootDir>/tests/mocks/electron.ts',
        '^better-sqlite3$': '<rootDir>/tests/mocks/better-sqlite3.ts',
        '\\.(css|less|scss)$': '<rootDir>/tests/mocks/styleMock.ts'
      }
    }
  ]
}
