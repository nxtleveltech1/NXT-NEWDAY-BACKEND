// NILEDB Configuration - THE ONLY DATABASE
module.exports = {
  connection: {
    host: 'eu-central-1.db.thenile.dev',
    database: 'NILEDB',
    user: '01985dad-5492-710e-a575-76c9bc6f3c98',
    password: '216d1021-70e6-420a-b7c7-c9b8ff3646fc',
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