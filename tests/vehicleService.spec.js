// tests/vehicleService.spec.js
import {jest, describe, test, expect, beforeEach} from '@jest/globals';

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {info: jest.fn(), warn: jest.fn(), error: jest.fn()}
}));

const {__db} = await import('./__mocks__/db.js');
// mock del pool
jest.unstable_mockModule('../config/db.js', () => ({default: __db, query: __db.query, connect: __db.connect}));

// importa SUTs *después* de los mocks
const {listVehiclesByParams, findVehicleById} = await import('../services/vehicleService.js');

describe('vehicleService (contrato actual)', () => {
  beforeEach(() => {
    __db.query.mockReset();
    __db.release.mockReset();
    __db.connect.mockReset().mockResolvedValue({query: __db.query, release: __db.release});
  });

  test('listVehiclesByParams: éxito con resultados (devuelve array)', async () => {
    __db.query.mockResolvedValueOnce({
      rows: [
        {id: 1, model: 'Corolla', status: 'available'},
        {id: 2, model: 'Escape', status: 'available'}
      ]
    });

    const data = await listVehiclesByParams({status: 'available', active: 'true'});

    expect(__db.query).toHaveBeenCalledTimes(1); // tu función hace 1 query
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
    expect(data[0].model).toBe('Corolla');
  });

  test('listVehiclesByParams: sin resultados -> []', async () => {
    __db.query.mockResolvedValueOnce({rows: []});

    const data = await listVehiclesByParams({status: 'available', active: 'true'});

    expect(__db.query).toHaveBeenCalledTimes(1);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  test('listVehiclesByParams: error de BD propaga reject', async () => {
    __db.query.mockRejectedValueOnce(new Error('db failure'));
    await expect(listVehiclesByParams({})).rejects.toThrow('db failure');
  });

  test('findVehicleById: devuelve una fila', async () => {
    __db.query.mockResolvedValueOnce({rows: [{id: 123, model: 'Corolla', images: []}]});

    const v = await findVehicleById(123);

    expect(__db.query).toHaveBeenCalledWith(expect.any(String), [123]);
    expect(v?.id).toBe(123);
  });

  test('findVehicleById: no encontrado -> null', async () => {
    __db.query.mockResolvedValueOnce({rows: []});

    const v = await findVehicleById(999);

    expect(v).toHaveLength(0);
  });
});
