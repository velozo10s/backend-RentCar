// import {makeDbMock} from './dbMock.js';
//
// const db = makeDbMock();
// export const pool = db.pool;
// export default pool;
// export const __db = db; // export handle to adjust expectations in tests
import {jest} from '@jest/globals';

export const __db = {
  query: jest.fn(),
  connect: jest.fn().mockResolvedValue({
    query: jest.fn(),
    release: jest.fn(),
  }),
  release: jest.fn(),
};

export default __db;
