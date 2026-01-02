#!/usr/bin/env node

/**
 * Script para crear usuario administrador por defecto
 * Ejecutar con: node create-admin.js
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

async function createAdminUser() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
        console.log('🔧 Creando usuario administrador por defecto...\n');

        // Datos del usuario administrador
        const adminData = {
            username: 'admin',
            password: 'Admin123!',
            role: 'admin'
        };

        // Generar hash de la contraseña
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(adminData.password, saltRounds);

        // Insertar usuario en la base de datos
        const result = await pool.query(`
            INSERT INTO users (username, password_hash, role, active, created_at, updated_at)
            VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (username) DO NOTHING
            RETURNING id, username, role
        `, [adminData.username, passwordHash, adminData.role]);

        if (result.rows.length > 0) {
            console.log('✅ Usuario administrador creado exitosamente!');
            console.log('👤 Usuario:', result.rows[0].username);
            console.log('🔒 Rol:', result.rows[0].role);
        } else {
            console.log('⚠️  El usuario administrador ya existe');
        }

        // Mostrar credenciales
        console.log('\n🔑 CREDENCIALES DE ACCESO:');
        console.log('=' .repeat(40));
        console.log(`👤 Usuario: ${adminData.username}`);
        console.log(`🔒 Contraseña: ${adminData.password}`);
        console.log(`👑 Rol: ${adminData.role}`);
        console.log('=' .repeat(40));
        console.log('\n⚠️  IMPORTANTE: Cambia la contraseña después del primer login!');
        console.log('🔗 URL de login: http://localhost:3000/login.html (desarrollo)');
        console.log('🌐 URL de login: https://tu-app.railway.app/login.html (producción)');

    } catch (error) {
        console.error('❌ Error al crear usuario administrador:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Crear usuario regular de ejemplo también
async function createRegularUser() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
        console.log('\n👤 Creando usuario regular de ejemplo...\n');

        const userData = {
            username: 'usuario',
            password: 'Usuario123!',
            role: 'user'
        };

        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(userData.password, saltRounds);

        const result = await pool.query(`
            INSERT INTO users (username, password_hash, role, active, created_at, updated_at)
            VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (username) DO NOTHING
            RETURNING id, username, role
        `, [userData.username, passwordHash, userData.role]);

        if (result.rows.length > 0) {
            console.log('✅ Usuario regular creado exitosamente!');
            console.log('👤 Usuario:', result.rows[0].username);
            console.log('🔒 Rol:', result.rows[0].role);
        } else {
            console.log('⚠️  El usuario regular ya existe');
        }

        console.log('\n🔑 CREDENCIALES DE USUARIO REGULAR:');
        console.log('=' .repeat(40));
        console.log(`👤 Usuario: ${userData.username}`);
        console.log(`🔒 Contraseña: ${userData.password}`);
        console.log(`📝 Rol: ${userData.role}`);
        console.log('=' .repeat(40));

    } catch (error) {
        console.error('❌ Error al crear usuario regular:', error.message);
    } finally {
        await pool.end();
    }
}

// Función principal
async function main() {
    console.log('🚀 SISTEMA DE GESTIÓN DE QUEJAS');
    console.log('Creación de usuarios por defecto\n');

    // Verificar variables de entorno
    if (!process.env.DATABASE_URL) {
        console.error('❌ Error: DATABASE_URL no está configurada');
        console.log('💡 Asegúrate de tener un archivo .env con DATABASE_URL configurada');
        process.exit(1);
    }

    await createAdminUser();
    await createRegularUser();

    console.log('\n✨ Proceso completado!');
    console.log('💡 Puedes ejecutar este script nuevamente si necesitas recrear los usuarios');
}

// Ejecutar si se llama directamente
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { createAdminUser, createRegularUser };