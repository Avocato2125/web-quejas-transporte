// ===========================================
// SCRIPT DE MIGRACIÓN DE BASE DE DATOS
// ===========================================

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

console.log('🗄️  Iniciando migración de base de datos...\n');

// ===========================================
// CONFIGURACIÓN DE BASE DE DATOS
// ===========================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ===========================================
// FUNCIONES DE MIGRACIÓN
// ===========================================

async function testConnection() {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        client.release();
        console.log('SUCCESS: Conexión a la base de datos exitosa');
        console.log(`   Hora del servidor: ${result.rows[0].now}`);
        return true;
    } catch (error) {
        console.error('ERROR: Error conectando a la base de datos:', error.message);
        return false;
    }
}

async function createDatabase() {
    try {
        // Crear base de datos si no existe
        const dbName = process.env.DATABASE_URL.split('/').pop();
        const baseUrl = process.env.DATABASE_URL.replace(`/${dbName}`, '');
        
        const tempPool = new Pool({
            connectionString: baseUrl + '/postgres',
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        const client = await tempPool.connect();
        
        // Verificar si la base de datos existe
        const dbExists = await client.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [dbName]
        );
        
        if (dbExists.rows.length === 0) {
            await client.query(`CREATE DATABASE "${dbName}"`);
            console.log(`SUCCESS: Base de datos '${dbName}' creada`);
        } else {
            console.log(`SUCCESS: Base de datos '${dbName}' ya existe`);
        }
        
        client.release();
        await tempPool.end();
        
    } catch (error) {
        console.error('ERROR: Error creando base de datos:', error.message);
        throw error;
    }
}

async function runSchema() {
    try {
        const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
        
        if (!fs.existsSync(schemaPath)) {
            throw new Error('Archivo de esquema no encontrado: database/schema.sql');
        }
        
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('Ejecutando esquema de base de datos...');
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            await client.query(schema);
            await client.query('COMMIT');
            
            console.log('SUCCESS: Esquema ejecutado exitosamente');
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('ERROR: Error ejecutando esquema:', error.message);
        throw error;
    }
}

async function createAdminUser() {
    try {
        const bcrypt = require('bcrypt');
        
        // Verificar si ya existe un usuario admin
        const client = await pool.connect();
        
        const existingAdmin = await client.query(
            'SELECT id FROM users WHERE username = $1',
            ['admin']
        );
        
        if (existingAdmin.rows.length > 0) {
            console.log('SUCCESS: Usuario administrador ya existe');
            client.release();
            return;
        }
        
        // Crear usuario administrador
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        
        await client.query(
            'INSERT INTO users (username, password_hash, role, active) VALUES ($1, $2, $3, $4)',
            ['admin', hashedPassword, 'admin', true]
        );
        
        console.log('SUCCESS: Usuario administrador creado');
        console.log('   Usuario: admin');
        console.log(`   Contraseña: ${adminPassword}`);
        console.log('   WARNING: CAMBIA ESTA CONTRASEÑA INMEDIATAMENTE');
        
        client.release();
        
    } catch (error) {
        console.error('ERROR: Error creando usuario administrador:', error.message);
        throw error;
    }
}

async function verifyTables() {
    try {
        const client = await pool.connect();
        
        const tables = [
            'users',
            'refresh_tokens',
            'quejas_retraso',
            'quejas_mal_trato',
            'quejas_inseguridad',
            'quejas_unidad_mal_estado',
            'quejas_otro',
            'resoluciones',
            'audit_log'
        ];
        
        console.log('Verificando tablas...');
        
        for (const table of tables) {
            const result = await client.query(
                'SELECT COUNT(*) FROM information_schema.tables WHERE table_name = $1',
                [table]
            );
            
            if (result.rows[0].count > 0) {
                console.log(`   SUCCESS: Tabla '${table}' existe`);
            } else {
                console.log(`   ERROR: Tabla '${table}' no encontrada`);
            }
        }
        
        client.release();
        
    } catch (error) {
        console.error('ERROR: Error verificando tablas:', error.message);
        throw error;
    }
}

async function createIndexes() {
    try {
        const client = await pool.connect();
        
        console.log('Creando índices adicionales...');
        
        // Índices adicionales para optimización
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_quejas_retraso_fecha_estado ON quejas_retraso(fecha_creacion, estado_queja)',
            'CREATE INDEX IF NOT EXISTS idx_quejas_mal_trato_fecha_estado ON quejas_mal_trato(fecha_creacion, estado_queja)',
            'CREATE INDEX IF NOT EXISTS idx_quejas_inseguridad_fecha_estado ON quejas_inseguridad(fecha_creacion, estado_queja)',
            'CREATE INDEX IF NOT EXISTS idx_quejas_unidad_mal_estado_fecha_estado ON quejas_unidad_mal_estado(fecha_creacion, estado_queja)',
            'CREATE INDEX IF NOT EXISTS idx_quejas_otro_fecha_estado ON quejas_otro(fecha_creacion, estado_queja)',
            'CREATE INDEX IF NOT EXISTS idx_users_username_active ON users(username, active)',
            'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_expires ON refresh_tokens(user_id, expires_at, revoked)'
        ];
        
        for (const indexQuery of indexes) {
            await client.query(indexQuery);
        }
        
        console.log('SUCCESS: Índices creados exitosamente');
        
        client.release();
        
    } catch (error) {
        console.error('ERROR: Error creando índices:', error.message);
        throw error;
    }
}

async function runMigrations() {
    try {
        console.log('🔄 Ejecutando migraciones...');
        
        // Aquí se pueden agregar migraciones específicas
        // Por ejemplo, cambios en la estructura de tablas existentes
        
        console.log('SUCCESS: Migraciones completadas');
        
    } catch (error) {
        console.error('ERROR: Error en migraciones:', error.message);
        throw error;
    }
}

async function generateReport() {
    try {
        const client = await pool.connect();
        
        console.log('\nREPORTE DE BASE DE DATOS:');
        console.log('============================');
        
        // Contar registros en cada tabla
        const tables = [
            'users',
            'quejas_retraso',
            'quejas_mal_trato',
            'quejas_inseguridad',
            'quejas_unidad_mal_estado',
            'quejas_otro',
            'resoluciones'
        ];
        
        for (const table of tables) {
            try {
                const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
                console.log(`   ${table}: ${result.rows[0].count} registros`);
            } catch (error) {
                console.log(`   ${table}: Error al contar registros`);
            }
        }
        
        // Información de la base de datos
        const dbInfo = await client.query(`
            SELECT 
                current_database() as database_name,
                version() as postgres_version,
                current_user as current_user,
                inet_server_addr() as server_ip,
                inet_server_port() as server_port
        `);
        
        console.log('\nINFORMACIÓN DE LA BASE DE DATOS:');
        console.log('====================================');
        console.log(`   Base de datos: ${dbInfo.rows[0].database_name}`);
        console.log(`   Usuario: ${dbInfo.rows[0].current_user}`);
        console.log(`   Servidor: ${dbInfo.rows[0].server_ip}:${dbInfo.rows[0].server_port}`);
        console.log(`   PostgreSQL: ${dbInfo.rows[0].postgres_version.split(' ')[0]}`);
        
        client.release();
        
    } catch (error) {
        console.error('ERROR: Error generando reporte:', error.message);
    }
}

// ===========================================
// FUNCIÓN PRINCIPAL
// ===========================================

async function main() {
    try {
        // Verificar variables de entorno
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL no está configurada en las variables de entorno');
        }
        
        console.log('Configuración:');
        console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
        console.log(`   Base de datos: ${process.env.DATABASE_URL.split('@')[1] || 'localhost'}`);
        console.log('');
        
        // Ejecutar migración paso a paso
        await testConnection();
        await createDatabase();
        await runSchema();
        await createIndexes();
        await runMigrations();
        await createAdminUser();
        await verifyTables();
        await generateReport();
        
        console.log('\nSUCCESS: Migración de base de datos completada exitosamente!');
        console.log('\n📝 PRÓXIMOS PASOS:');
        console.log('1. Verificar que el usuario administrador funciona');
        console.log('2. Ejecutar tests: npm test');
        console.log('3. Iniciar el servidor: npm start');
        console.log('4. Acceder a http://localhost:3000/login.html');
        
    } catch (error) {
        console.error('\nERROR: Error en la migración:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    main();
}

module.exports = {
    testConnection,
    createDatabase,
    runSchema,
    createAdminUser,
    verifyTables,
    createIndexes,
    runMigrations,
    generateReport
};
