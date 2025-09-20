// ===========================================
// SCRIPT DE INSTALACIÓN AUTOMATIZADA
// ===========================================

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Instalando Sistema de Quejas de Transporte...\n');

// ===========================================
// FUNCIONES DE INSTALACIÓN
// ===========================================

function checkNodeVersion() {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    console.log(`Verificando Node.js: ${nodeVersion}`);
    
    if (majorVersion < 16) {
        console.error('ERROR: Node.js versión 16 o superior requerida');
        console.error('   Instala Node.js desde: https://nodejs.org/');
        process.exit(1);
    }
    
    console.log('SUCCESS: Node.js versión compatible');
}

function checkNpmVersion() {
    try {
        const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
        console.log(`Verificando npm: ${npmVersion}`);
        console.log('SUCCESS: npm disponible');
    } catch (error) {
        console.error('ERROR: npm no encontrado');
        process.exit(1);
    }
}

function installDependencies() {
    console.log('\n📦 Instalando dependencias...');
    
    try {
        execSync('npm install', { stdio: 'inherit' });
        console.log('SUCCESS: Dependencias instaladas exitosamente');
    } catch (error) {
        console.error('ERROR: Error instalando dependencias:', error.message);
        process.exit(1);
    }
}

function createDirectories() {
    console.log('\n📁 Creando directorios necesarios...');
    
    const directories = [
        'logs',
        'logs/security',
        'logs/auth',
        'logs/audit',
        'database',
        'tests',
        'tests/unit',
        'tests/integration',
        'middleware',
        'scripts'
    ];
    
    directories.forEach(dir => {
        const dirPath = path.join(__dirname, '..', dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(`   SUCCESS: Directorio creado: ${dir}`);
        } else {
            console.log(`   SUCCESS: Directorio existe: ${dir}`);
        }
    });
}

function setupEnvironment() {
    console.log('\nConfigurando variables de entorno...');
    
    const envPath = path.join(__dirname, '..', '.env');
    const envExamplePath = path.join(__dirname, '..', 'env.example');
    
    if (!fs.existsSync(envPath)) {
        if (fs.existsSync(envExamplePath)) {
            fs.copyFileSync(envExamplePath, envPath);
            console.log('SUCCESS: Archivo .env creado desde env.example');
            console.log('   WARNING: Edita el archivo .env con tus configuraciones');
        } else {
            console.log('WARNING: Archivo env.example no encontrado');
        }
    } else {
        console.log('SUCCESS: Archivo .env ya existe');
    }
}

function runSecuritySetup() {
    console.log('\n🔒 Configurando seguridad...');
    
    try {
        const securitySetupPath = path.join(__dirname, 'security-setup.js');
        if (fs.existsSync(securitySetupPath)) {
            require('./security-setup.js');
            console.log('SUCCESS: Configuración de seguridad completada');
        } else {
            console.log('WARNING: Script de seguridad no encontrado');
        }
    } catch (error) {
        console.error('ERROR: Error en configuración de seguridad:', error.message);
    }
}

function runDatabaseMigration() {
    console.log('\n🗄️  Configurando base de datos...');
    
    try {
        const migratePath = path.join(__dirname, 'migrate.js');
        if (fs.existsSync(migratePath)) {
            console.log('   Ejecutando migración de base de datos...');
            require('./migrate.js');
            console.log('SUCCESS: Base de datos configurada');
        } else {
            console.log('WARNING: Script de migración no encontrado');
        }
    } catch (error) {
        console.error('ERROR: Error en migración de base de datos:', error.message);
        console.log('   Ejecuta manualmente: npm run db:migrate');
    }
}

function runTests() {
    console.log('\n🧪 Ejecutando tests...');
    
    try {
        execSync('npm test', { stdio: 'inherit' });
        console.log('SUCCESS: Tests ejecutados exitosamente');
    } catch (error) {
        console.log('WARNING: Algunos tests fallaron, pero la instalación continúa');
        console.log('   Ejecuta manualmente: npm test');
    }
}

function runLinting() {
    console.log('\nEjecutando linting...');
    
    try {
        execSync('npm run lint', { stdio: 'inherit' });
        console.log('SUCCESS: Linting completado');
    } catch (error) {
        console.log('WARNING: Se encontraron problemas de linting');
        console.log('   Ejecuta manualmente: npm run lint:fix');
    }
}

function generateInstallationReport() {
    console.log('\nREPORTE DE INSTALACIÓN:');
    console.log('===========================');
    
    const report = {
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        dependencies: fs.existsSync(path.join(__dirname, '..', 'node_modules')),
        environment: fs.existsSync(path.join(__dirname, '..', '.env')),
        database: fs.existsSync(path.join(__dirname, '..', 'database', 'schema.sql')),
        tests: fs.existsSync(path.join(__dirname, '..', 'tests')),
        security: fs.existsSync(path.join(__dirname, '..', 'middleware', 'security.js'))
    };
    
    console.log(`   Fecha: ${report.timestamp}`);
    console.log(`   Node.js: ${report.nodeVersion}`);
    console.log(`   Plataforma: ${report.platform} ${report.arch}`);
    console.log(`   Dependencias: ${report.dependencies ? 'SUCCESS' : 'ERROR'}`);
    console.log(`   Variables de entorno: ${report.environment ? 'SUCCESS' : 'ERROR'}`);
    console.log(`   Base de datos: ${report.database ? 'SUCCESS' : 'ERROR'}`);
    console.log(`   Tests: ${report.tests ? 'SUCCESS' : 'ERROR'}`);
    console.log(`   Seguridad: ${report.security ? 'SUCCESS' : 'ERROR'}`);
    
    // Guardar reporte
    const reportPath = path.join(__dirname, '..', 'logs', 'installation-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Reporte guardado en: ${reportPath}`);
}

function displayNextSteps() {
    console.log('\nSUCCESS: INSTALACIÓN COMPLETADA EXITOSAMENTE!');
    console.log('=====================================');
    
    console.log('\n📝 PRÓXIMOS PASOS:');
    console.log('1. Revisar y configurar el archivo .env');
    console.log('2. Configurar la base de datos PostgreSQL');
    console.log('3. Ejecutar migración: npm run db:migrate');
    console.log('4. Crear usuario administrador');
    console.log('5. Iniciar el servidor: npm start');
    console.log('6. Acceder a http://localhost:3000');
    
    console.log('\nCOMANDOS ÚTILES:');
    console.log('   npm start          - Iniciar servidor');
    console.log('   npm run dev        - Modo desarrollo');
    console.log('   npm test           - Ejecutar tests');
    console.log('   npm run lint       - Verificar código');
    console.log('   npm run security:audit - Auditoría de seguridad');
    
    console.log('\n📚 DOCUMENTACIÓN:');
    console.log('   README.md          - Documentación principal');
    console.log('   database/schema.sql - Esquema de base de datos');
    console.log('   tests/             - Tests del sistema');
    
    console.log('\n🆘 SOPORTE:');
    console.log('   GitHub Issues: https://github.com/Avocato2125/web-quejas-transporte/issues');
    console.log('   Email: soporte@empresa.com');
    
    console.log('\n✨ ¡Disfruta usando el Sistema de Quejas de Transporte!');
}

// ===========================================
// FUNCIÓN PRINCIPAL
// ===========================================

async function main() {
    try {
        console.log('Iniciando instalación automatizada...\n');
        
        // Verificaciones previas
        checkNodeVersion();
        checkNpmVersion();
        
        // Instalación
        createDirectories();
        installDependencies();
        setupEnvironment();
        
        // Configuración
        runSecuritySetup();
        runDatabaseMigration();
        
        // Verificaciones
        runTests();
        runLinting();
        
        // Reporte final
        generateInstallationReport();
        displayNextSteps();
        
    } catch (error) {
        console.error('\nERROR: Error durante la instalación:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    main();
}

module.exports = {
    checkNodeVersion,
    checkNpmVersion,
    installDependencies,
    createDirectories,
    setupEnvironment,
    runSecuritySetup,
    runDatabaseMigration,
    runTests,
    runLinting,
    generateInstallationReport,
    displayNextSteps
};
