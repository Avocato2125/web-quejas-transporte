const os = require('os');
const { performance } = require('perf_hooks');

/**
 * Monitor de Rendimiento en Tiempo Real
 * Ejecutar con: node monitor.js
 */

class PerformanceMonitor {
    constructor() {
        this.startTime = performance.now();
        this.metrics = {
            memory: {},
            cpu: {},
            requests: 0,
            errors: 0
        };
    }

    // Monitoreo de memoria
    getMemoryUsage() {
        const memUsage = process.memoryUsage();
        return {
            rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
            heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
            heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
            external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`
        };
    }

    // Monitoreo de CPU
    getCpuUsage() {
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;

        cpus.forEach(cpu => {
            for (let type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        });

        const idle = totalIdle / cpus.length;
        const total = totalTick / cpus.length;
        const usage = 100 - ~~(100 * idle / total);

        return {
            usage: `${usage}%`,
            cores: cpus.length,
            model: cpus[0].model
        };
    }

    // Monitoreo del sistema
    getSystemInfo() {
        return {
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
            uptime: `${(os.uptime() / 3600).toFixed(2)} horas`,
            loadAverage: os.loadavg(),
            totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
            freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`
        };
    }

    // Monitoreo de aplicación
    getAppMetrics() {
        const uptime = performance.now() - this.startTime;
        return {
            uptime: `${(uptime / 1000 / 60).toFixed(2)} minutos`,
            nodeVersion: process.version,
            pid: process.pid,
            requests: this.metrics.requests,
            errors: this.metrics.errors
        };
    }

    // Mostrar métricas
    displayMetrics() {
        console.clear();
        console.log('='.repeat(60));
        console.log('📊 MONITOR DE RENDIMIENTO - SISTEMA DE QUEJAS');
        console.log('='.repeat(60));
        console.log(`⏰ ${new Date().toLocaleString()}`);
        console.log('');

        // Memoria
        console.log('🧠 MEMORIA DEL PROCESO:');
        const mem = this.getMemoryUsage();
        console.log(`   RSS: ${mem.rss}`);
        console.log(`   Heap Total: ${mem.heapTotal}`);
        console.log(`   Heap Used: ${mem.heapUsed}`);
        console.log(`   External: ${mem.external}`);
        console.log('');

        // CPU
        console.log('⚡ CPU:');
        const cpu = this.getCpuUsage();
        console.log(`   Uso: ${cpu.usage}`);
        console.log(`   Núcleos: ${cpu.cores}`);
        console.log(`   Modelo: ${cpu.model}`);
        console.log('');

        // Sistema
        console.log('🖥️  SISTEMA:');
        const sys = this.getSystemInfo();
        console.log(`   Plataforma: ${sys.platform} ${sys.arch}`);
        console.log(`   Memoria Total: ${sys.totalMemory}`);
        console.log(`   Memoria Libre: ${sys.freeMemory}`);
        console.log(`   Carga Promedio: ${sys.loadAverage.map(l => l.toFixed(2)).join(', ')}`);
        console.log('');

        // Aplicación
        console.log('🚀 APLICACIÓN:');
        const app = this.getAppMetrics();
        console.log(`   Uptime: ${app.uptime}`);
        console.log(`   Node.js: ${app.nodeVersion}`);
        console.log(`   PID: ${app.pid}`);
        console.log(`   Requests: ${app.requests}`);
        console.log(`   Errors: ${app.errors}`);
        console.log('');

        // Alertas
        this.checkAlerts(mem, cpu);
    }

    // Verificar alertas
    checkAlerts(mem, cpu) {
        console.log('🚨 ALERTAS:');

        const heapUsed = parseFloat(mem.heapUsed);
        if (heapUsed > 200) {
            console.log('   ⚠️  Alto uso de memoria heap (>200MB)');
        }

        const cpuUsage = parseFloat(cpu.usage.replace('%', ''));
        if (cpuUsage > 80) {
            console.log('   ⚠️  Alto uso de CPU (>80%)');
        }

        if (this.metrics.errors > 10) {
            console.log('   ❌ Alto número de errores');
        }

        console.log('   ✅ Todo normal');
        console.log('='.repeat(60));
    }

    // Incrementar contadores
    incrementRequests() {
        this.metrics.requests++;
    }

    incrementErrors() {
        this.metrics.errors++;
    }

    // Iniciar monitoreo
    start(interval = 5000) {
        console.log('🔍 Iniciando monitoreo cada', interval / 1000, 'segundos...');
        console.log('Presiona Ctrl+C para detener\n');

        this.interval = setInterval(() => {
            this.displayMetrics();
        }, interval);

        // Manejar señales de terminación
        process.on('SIGINT', () => {
            console.log('\n👋 Deteniendo monitor...');
            clearInterval(this.interval);
            process.exit(0);
        });
    }
}

// Exportar para uso en otros módulos
module.exports = PerformanceMonitor;

// Si se ejecuta directamente
if (require.main === module) {
    const monitor = new PerformanceMonitor();
    monitor.start();
}