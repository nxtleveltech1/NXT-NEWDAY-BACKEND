// NILEDB Configuration - PRODUCTION ONLY
module.exports = {
  connection: {
    host: 'eu-central-1.db.thenile.dev',
    database: 'NILEDB',
    user: '019864b1-5486-74e4-b499-5c3c20e5d483',
    password: '933d9c72-25b1-4078-b0f4-ca227857b75a',
    port: 5432,
    ssl: {
      rejectUnauthorized: false
    }
  },
  pool: {
    min: 2,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
  api: {
    url: 'https://eu-central-1.api.thenile.dev/v2/databases/01985dad-511f-75c6-9d58-6eca1896951d'
  }
};