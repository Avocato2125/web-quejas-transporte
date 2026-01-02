#!/usr/bin/env node

/**
 * Script de Optimización de Rendimiento
 * Ejecutar antes del despliegue para optimizar la aplicación
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 Iniciando optimización de rendimiento...\n');

// 1. Verificar archivos innecesarios
console.log('📁 Verificando archivos innecesarios...');
const unnecessaryFiles = [
    '.env',
    '.nvmrc',
    'railway.json',
    'logs/',
    'credentials/',
    'database/',
    'scripts/'
];

unnecessaryFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        console.log(`⚠️  Archivo innecesario encontrado: ${file}`);
    }
});

// 2. Optimizar package.json
console.log('\n📦 Optimizando package.json...');
const packagePath = path.join(__dirname, 'package.json');
if (fs.existsSync(packagePath)) {
    const package = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    // Remover scripts innecesarios
    const scriptsToRemove = ['db:migrate', 'db:seed'];
    scriptsToRemove.forEach(script => {
        if (package.scripts && package.scripts[script]) {
            delete package.scripts[script];
            console.log(`🗑️  Script removido: ${script}`);
        }
    });

    // Verificar que el script start apunte al archivo correcto
    if (package.scripts.start !== 'node server.js') {
        console.log('⚠️  Script start debería ser: "node server.js"');
    }

    fs.writeFileSync(packagePath, JSON.stringify(package, null, 2));
}

// 3. Verificar configuraciones de seguridad
console.log('\n🔒 Verificando configuraciones de seguridad...');
const serverPath = path.join(__dirname, 'server.js');
if (fs.existsSync(serverPath)) {
    const serverContent = fs.readFileSync(serverPath, 'utf8');

    const securityChecks = [
        { name: 'Helmet', pattern: /helmet/ },
        { name: 'Rate Limiting', pattern: /rateLimit|express-rate-limit/ },
        { name: 'CORS', pattern: /cors/ },
        { name: 'Input Sanitization', pattern: /express-mongo-sanitize|dompurify/ }
    ];

    securityChecks.forEach(check => {
        if (serverContent.match(check.pattern)) {
            console.log(`✅ ${check.name}: Implementado`);
        } else {
            console.log(`❌ ${check.name}: NO encontrado`);
        }
    });
}

// 4. Verificar optimizaciones de base de datos
console.log('\n🗄️  Verificando optimizaciones de base de datos...');
const dbPath = path.join(__dirname, 'config', 'database.js');
if (fs.existsSync(dbPath)) {
    const dbContent = fs.readFileSync(dbPath, 'utf8');

    const dbOptimizations = [
        { name: 'Connection Pooling', pattern: /Pool|pool/ },
        { name: 'Error Handling', pattern: /catch|try/ },
        { name: 'Prepared Statements', pattern: /\$[0-9]/ }
    ];

    dbOptimizations.forEach(opt => {
        if (dbContent.match(opt.pattern)) {
            console.log(`✅ ${opt.name}: Implementado`);
        } else {
            console.log(`⚠️  ${opt.name}: Verificar implementación`);
        }
    });
}

// 5. Recomendaciones finales
console.log('\n🎯 RECOMENDACIONES FINALES:');
console.log('1. ✅ Eliminar archivos innecesarios (.env, logs/, etc.)');
console.log('2. ✅ Usar Dockerfile optimizado con usuario no-root');
console.log('3. ✅ Configurar health checks en Railway');
console.log('4. ✅ Implementar compresión gzip');
console.log('5. ✅ Configurar cache headers apropiados');
console.log('6. ✅ Usar CDN para archivos estáticos en producción');
console.log('7. ✅ Monitorear uso de memoria y CPU');
console.log('8. ✅ Implementar logging estructurado');

console.log('\n✨ Optimización completada!');