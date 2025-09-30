const { Pool } = require('pg');
const { mainLogger: logger } = require('./logger');

class RailwayDatabaseManager {
    constructor(config) {
        this.config = config;
        this.pool = null;
        this.retryCount = 0;
        this.maxRetries = 5;
        this.retryDelay = 5000; // 5 segundos
    }

    async initialize() {
        if (!this.pool) {
            this.pool = new Pool(this.config);

            this.pool.on('error', (err, client) => {
                logger.error('Error inesperado en el cliente de PostgreSQL:', err);
                this.handlePoolError(err);
            });

            // Verificar conexión
            try {
                await this.testConnection();
                logger.info('Conexión a PostgreSQL establecida exitosamente');
            } catch (err) {
                logger.error('Error al conectar con PostgreSQL:', err);
                await this.handleConnectionError();
            }
        }
        return this.pool;
    }

    async testConnection() {
        const client = await this.pool.connect();
        try {
            await client.query('SELECT NOW()');
        } finally {
            client.release();
        }
    }

    async handleConnectionError() {
        if (this.retryCount < this.maxRetries) {
            this.retryCount++;
            logger.warn(`Reintentando conexión (${this.retryCount}/${this.maxRetries})...`);
            
            await new Promise(resolve => setTimeout(resolve, this.retryDelay));
            return this.initialize();
        } else {
            throw new Error('No se pudo establecer conexión con la base de datos después de múltiples intentos');
        }
    }

    handlePoolError(err) {
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            logger.warn('Conexión perdida con la base de datos. Reintentando...');
            this.initialize();
        } else {
            throw err;
        }
    }

    async query(text, params) {
        const client = await this.pool.connect();
        try {
            const start = Date.now();
            const res = await client.query(text, params);
            const duration = Date.now() - start;
            
            logger.debug('Executed query', { 
                text, 
                duration, 
                rows: res.rowCount 
            });
            
            return res;
        } catch (err) {
            logger.error('Error executing query:', { 
                text, 
                error: err.message 
            });
            throw err;
        } finally {
            client.release();
        }
    }

    async transaction(callback) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.retryCount = 0;
        }
    }
}

module.exports = DatabaseManager;