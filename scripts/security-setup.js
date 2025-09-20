// ===========================================
// SCRIPT DE CONFIGURACIÓN DE SEGURIDAD
// ===========================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

console.log('🔒 Configurando seguridad del sistema...\n');

// ===========================================
// GENERAR SECRETS SEGUROS
// ===========================================

function generateSecureSecret(length = 64) {
    return crypto.randomBytes(length).toString('hex');
}

function generateJWTSecret() {
    return generateSecureSecret(32);
}

function generateSessionSecret() {
    return generateSecureSecret(32);
}

// ===========================================
// CREAR ARCHIVO .env SEGURO
// ===========================================

function createSecureEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');
    const envExamplePath = path.join(__dirname, '..', 'env.example');
    
    if (fs.existsSync(envPath)) {
        console.log('WARNING: Archivo .env ya existe. Creando backup...');
        const backupPath = `${envPath}.backup.${Date.now()}`;
        fs.copyFileSync(envPath, backupPath);
        console.log(`SUCCESS: Backup creado en: ${backupPath}`);
    }
    
    if (!fs.existsSync(envExamplePath)) {
        console.log('ERROR: Archivo env.example no encontrado');
        return;
    }
    
    let envContent = fs.readFileSync(envExamplePath, 'utf8');
    
    // Reemplazar secrets con valores seguros
    const jwtSecret = generateJWTSecret();
    const refreshJwtSecret = generateJWTSecret();
    const sessionSecret = generateSessionSecret();
    
    envContent = envContent.replace(
        'tu_jwt_secret_muy_seguro_aqui_minimo_32_caracteres',
        jwtSecret
    );
    
    envContent = envContent.replace(
        'tu_refresh_jwt_secret_muy_seguro_aqui_minimo_32_caracteres',
        refreshJwtSecret
    );
    
    envContent = envContent.replace(
        'tu_session_secret_muy_seguro_aqui',
        sessionSecret
    );
    
    // Configurar base de datos de prueba
    envContent = envContent.replace(
        'postgresql://usuario:password@localhost:5432/quejas_transporte',
        'postgresql://postgres:password@localhost:5432/quejas_transporte'
    );
    
    fs.writeFileSync(envPath, envContent);
    console.log('SUCCESS: Archivo .env creado con secrets seguros');
}

// ===========================================
// CONFIGURAR PERMISOS DE ARCHIVOS
// ===========================================

function setSecureFilePermissions() {
    const filesToSecure = [
        '.env',
        'logs/',
        'credentials/',
        'database/'
    ];
    
    filesToSecure.forEach(file => {
        const filePath = path.join(__dirname, '..', file);
        if (fs.existsSync(filePath)) {
            try {
                // En sistemas Unix-like, establecer permisos restrictivos
                if (process.platform !== 'win32') {
                    fs.chmodSync(filePath, 0o600); // Solo lectura/escritura para el propietario
                    console.log(`SUCCESS: Permisos seguros establecidos para: ${file}`);
                }
            } catch (error) {
                console.log(`WARNING: No se pudieron establecer permisos para: ${file}`);
            }
        }
    });
}

// ===========================================
// CREAR DIRECTORIOS DE LOGS
// ===========================================

function createLogDirectories() {
    const logDirs = [
        'logs',
        'logs/security',
        'logs/auth',
        'logs/audit'
    ];
    
    logDirs.forEach(dir => {
        const dirPath = path.join(__dirname, '..', dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(`SUCCESS: Directorio creado: ${dir}`);
        }
    });
}

// ===========================================
// CONFIGURAR FIREWALL RULES (INFORMATIVO)
// ===========================================

function displayFirewallRecommendations() {
    console.log('\nRECOMENDACIONES DE FIREWALL:');
    console.log('================================');
    console.log('1. Permitir solo puerto 3000 (HTTP) y 3001 (HTTPS)');
    console.log('2. Bloquear acceso directo a la base de datos (puerto 5432)');
    console.log('3. Configurar rate limiting a nivel de servidor');
    console.log('4. Implementar fail2ban para IPs maliciosas');
    console.log('5. Usar Cloudflare o similar para DDoS protection');
}

// ===========================================
// VERIFICAR CONFIGURACIÓN DE SEGURIDAD
// ===========================================

function verifySecurityConfiguration() {
    console.log('\nVERIFICANDO CONFIGURACIÓN DE SEGURIDAD:');
    console.log('==========================================');
    
    const checks = [
        {
            name: 'Archivo .env existe',
            check: () => fs.existsSync(path.join(__dirname, '..', '.env'))
        },
        {
            name: 'Directorio de logs existe',
            check: () => fs.existsSync(path.join(__dirname, '..', 'logs'))
        },
        {
            name: 'Archivo de esquema de BD existe',
            check: () => fs.existsSync(path.join(__dirname, '..', 'database', 'schema.sql'))
        },
        {
            name: 'Variables de entorno críticas',
            check: () => {
                require('dotenv').config();
                return process.env.JWT_SECRET && 
                       process.env.REFRESH_JWT_SECRET && 
                       process.env.DATABASE_URL;
            }
        }
    ];
    
    checks.forEach(check => {
        try {
            const result = check.check();
            console.log(`${result ? 'SUCCESS' : 'ERROR'} ${check.name}`);
        } catch (error) {
            console.log(`ERROR ${check.name} - Error: ${error.message}`);
        }
    });
}

// ===========================================
// GENERAR REPORTE DE SEGURIDAD
// ===========================================

function generateSecurityReport() {
    const reportPath = path.join(__dirname, '..', 'logs', 'security-report.txt');
    const timestamp = new Date().toISOString();
    
    const report = `
REPORTE DE CONFIGURACIÓN DE SEGURIDAD
=====================================
Fecha: ${timestamp}
Sistema: ${process.platform} ${process.arch}
Node.js: ${process.version}

CONFIGURACIÓN APLICADA:
- Secrets JWT generados automáticamente
- Permisos de archivos configurados
- Directorios de logs creados
- Variables de entorno configuradas

RECOMENDACIONES ADICIONALES:
1. Cambiar contraseñas por defecto de la base de datos
2. Configurar SSL/TLS en producción
3. Implementar monitoreo de seguridad
4. Realizar auditorías regulares
5. Mantener dependencias actualizadas

PRÓXIMOS PASOS:
1. Ejecutar: npm run security:audit
2. Configurar base de datos con el esquema
3. Crear usuario administrador
4. Probar endpoints de seguridad
5. Configurar backup automático

CONTACTO DE SEGURIDAD:
- Email: seguridad@empresa.com
- Teléfono: +52-XXX-XXX-XXXX
- Incidentes: incidentes@empresa.com
`;

    fs.writeFileSync(reportPath, report);
    console.log(`\nReporte de seguridad generado: ${reportPath}`);
}

// ===========================================
// FUNCIÓN PRINCIPAL
// ===========================================

function main() {
    try {
        console.log('Iniciando configuración de seguridad...\n');
        
        // Crear directorios necesarios
        createLogDirectories();
        
        // Crear archivo .env seguro
        createSecureEnvFile();
        
        // Configurar permisos de archivos
        setSecureFilePermissions();
        
        // Verificar configuración
        verifySecurityConfiguration();
        
        // Mostrar recomendaciones
        displayFirewallRecommendations();
        
        // Generar reporte
        generateSecurityReport();
        
        console.log('\nSUCCESS: Configuración de seguridad completada exitosamente!');
        console.log('\n📝 PRÓXIMOS PASOS:');
        console.log('1. Revisar y ajustar el archivo .env según tu entorno');
        console.log('2. Configurar la base de datos: npm run db:migrate');
        console.log('3. Crear usuario administrador');
        console.log('4. Ejecutar tests de seguridad: npm test');
        console.log('5. Iniciar el servidor: npm start');
        
    } catch (error) {
        console.error('ERROR: Error en la configuración de seguridad:', error.message);
        process.exit(1);
    }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    main();
}

module.exports = {
    generateSecureSecret,
    generateJWTSecret,
    generateSessionSecret,
    createSecureEnvFile,
    setSecureFilePermissions,
    createLogDirectories,
    verifySecurityConfiguration,
    generateSecurityReport
};
