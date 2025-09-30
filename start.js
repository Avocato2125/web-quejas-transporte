console.log('='.repeat(60));
console.log('INICIANDO APLICACIÓN');
console.log('='.repeat(60));

// Capturar todos los errores
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:');
  console.error(error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ UNHANDLED REJECTION:');
  console.error(reason);
  process.exit(1);
});

console.log('
📋 Variables de entorno:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- PORT:', process.env.PORT);
console.log('- DATABASE_URL existe:', !!process.env.DATABASE_URL);
console.log('- JWT_SECRET existe:', !!process.env.JWT_SECRET);
console.log('- REFRESH_JWT_SECRET existe:', !!process.env.REFRESH_JWT_SECRET);

console.log('
🔄 Cargando server.js...
');

try {
  require('./server.js');
} catch (error) {
  console.error('❌ ERROR AL CARGAR SERVER.JS:');
  console.error(error);
  process.exit(1);
}
