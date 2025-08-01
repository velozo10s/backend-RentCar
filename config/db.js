import {Pool} from 'pg';

const pool = new Pool({
  host: 'localhost',
  user: 'postgres',
  password: process.env.DB_PASSWORD || '12345',
  //database: process.env.DB_NAME || 'RentCar',
  //port: process.env.DB_PORT || 5432,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  maxLifetimeSeconds: 60
})

export default pool;
