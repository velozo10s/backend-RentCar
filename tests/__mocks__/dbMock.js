import {jest} from "@jest/globals";

export function makeDbMock() {
  const query = jest.fn();
  const release = jest.fn();
  const connect = jest.fn().mockResolvedValue({query, release});
  return {
    pool: {query, connect},
    query, connect, release
  };
}
