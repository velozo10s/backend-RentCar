import logger from '../utils/logger.js';
import {listCustomersQuery, getCustomerDetailQuery} from '../services/customerService.js';

const LOG_LABEL = 'Customers';

export async function listCustomers(req, res) {
  try {
    const {q, active = 'all'} = req.query;
    const rows = await listCustomersQuery({q, active});
    return res.json(rows); // []
  } catch (err) {
    logger.error(`listCustomers failed: ${err.message}`, {label: LOG_LABEL, by: req.user?.id});
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  }
}

export async function getCustomerDetail(req, res) {
  const personId = Number(req.params.personId);
  if (!Number.isInteger(personId)) {
    return res.status(400).json({localKey: 'customers.validation.invalid_id', message: 'Invalid personId'});
  }

  try {
    const result = await getCustomerDetailQuery(personId);
    if (!result) {
      return res.status(404).json({localKey: 'customers.not_found', message: 'Customer not found'});
    }
    return res.json(result);
  } catch (err) {
    logger.error(`getCustomerDetail failed: ${err.message}`, {label: LOG_LABEL, by: req.user?.id});
    return res.status(500).json({localKey: 'common.internal_error', message: 'Internal error'});
  }
}
