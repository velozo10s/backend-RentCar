// Silence logger in tests (but keep interface)
import {jest} from "@jest/globals";

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Provide a default .env for dynamic roles
process.env.ALLOWED_EMPLOYEE_ROLES = 'employee,admin';
process.env.JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || 'test-public-key';
