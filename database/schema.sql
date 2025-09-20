-- ===========================================
-- ESQUEMA DE BASE DE DATOS - SISTEMA DE QUEJAS
-- ===========================================
-- Versión: 6.4
-- Fecha: $(date)
-- Descripción: Esquema completo para el sistema de gestión de quejas de transporte

-- ===========================================
-- EXTENSIONES
-- ===========================================

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Extensión para funciones de texto
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ===========================================
-- TABLA DE USUARIOS
-- ===========================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(30) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP
);

-- Índices para usuarios
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);

-- ===========================================
-- TABLA DE REFRESH TOKENS
-- ===========================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked BOOLEAN DEFAULT false,
    ip_address INET,
    user_agent TEXT
);

-- Índices para refresh tokens
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revoked ON refresh_tokens(revoked);

-- ===========================================
-- TABLA DE QUEJAS POR RETRASO
-- ===========================================

CREATE TABLE IF NOT EXISTS quejas_retraso (
    id SERIAL PRIMARY KEY,
    numero_empleado VARCHAR(10) NOT NULL,
    empresa VARCHAR(50) NOT NULL,
    ruta VARCHAR(100),
    colonia VARCHAR(100),
    turno VARCHAR(20),
    tipo VARCHAR(50) DEFAULT 'Retraso',
    latitud DECIMAL(10, 8),
    longitud DECIMAL(11, 8),
    numero_unidad VARCHAR(50),
    folio VARCHAR(20) UNIQUE NOT NULL,
    
    -- Campos específicos de retraso
    detalles_retraso TEXT,
    direccion_subida VARCHAR(200),
    hora_programada TIMESTAMP,
    hora_llegada TIMESTAMP,
    metodo_transporte_alterno VARCHAR(50),
    monto_gastado DECIMAL(10, 2),
    hora_llegada_planta TIMESTAMP,
    
    -- Campos de control
    estado_queja VARCHAR(20) DEFAULT 'Pendiente',
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT
);

-- ===========================================
-- TABLA DE QUEJAS POR MAL TRATO
-- ===========================================

CREATE TABLE IF NOT EXISTS quejas_mal_trato (
    id SERIAL PRIMARY KEY,
    numero_empleado VARCHAR(10) NOT NULL,
    empresa VARCHAR(50) NOT NULL,
    ruta VARCHAR(100),
    colonia VARCHAR(100),
    turno VARCHAR(20),
    tipo VARCHAR(50) DEFAULT 'Mal trato',
    latitud DECIMAL(10, 8),
    longitud DECIMAL(11, 8),
    numero_unidad VARCHAR(50),
    folio VARCHAR(20) UNIQUE NOT NULL,
    
    -- Campos específicos de mal trato
    nombre_conductor_maltrato VARCHAR(100),
    detalles_maltrato TEXT,
    
    -- Campos de control
    estado_queja VARCHAR(20) DEFAULT 'Pendiente',
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT
);

-- ===========================================
-- TABLA DE QUEJAS POR INSEGURIDAD
-- ===========================================

CREATE TABLE IF NOT EXISTS quejas_inseguridad (
    id SERIAL PRIMARY KEY,
    numero_empleado VARCHAR(10) NOT NULL,
    empresa VARCHAR(50) NOT NULL,
    ruta VARCHAR(100),
    colonia VARCHAR(100),
    turno VARCHAR(20),
    tipo VARCHAR(50) DEFAULT 'Inseguridad',
    latitud DECIMAL(10, 8),
    longitud DECIMAL(11, 8),
    numero_unidad VARCHAR(50),
    folio VARCHAR(20) UNIQUE NOT NULL,
    
    -- Campos específicos de inseguridad
    detalles_inseguridad TEXT,
    ubicacion_inseguridad VARCHAR(200),
    
    -- Campos de control
    estado_queja VARCHAR(20) DEFAULT 'Pendiente',
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT
);

-- ===========================================
-- TABLA DE QUEJAS POR MAL ESTADO DE UNIDAD
-- ===========================================

CREATE TABLE IF NOT EXISTS quejas_unidad_mal_estado (
    id SERIAL PRIMARY KEY,
    numero_empleado VARCHAR(10) NOT NULL,
    empresa VARCHAR(50) NOT NULL,
    ruta VARCHAR(100),
    colonia VARCHAR(100),
    turno VARCHAR(20),
    tipo VARCHAR(50) DEFAULT 'Unidad en mal estado',
    latitud DECIMAL(10, 8),
    longitud DECIMAL(11, 8),
    numero_unidad VARCHAR(50),
    folio VARCHAR(20) UNIQUE NOT NULL,
    
    -- Campos específicos de mal estado
    numero_unidad_malestado VARCHAR(50),
    tipo_falla VARCHAR(200),
    detalles_malestado TEXT,
    
    -- Campos de control
    estado_queja VARCHAR(20) DEFAULT 'Pendiente',
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT
);

-- ===========================================
-- TABLA DE OTRAS QUEJAS
-- ===========================================

CREATE TABLE IF NOT EXISTS quejas_otro (
    id SERIAL PRIMARY KEY,
    numero_empleado VARCHAR(10) NOT NULL,
    empresa VARCHAR(50) NOT NULL,
    ruta VARCHAR(100),
    colonia VARCHAR(100),
    turno VARCHAR(20),
    tipo VARCHAR(50) DEFAULT 'Otro',
    latitud DECIMAL(10, 8),
    longitud DECIMAL(11, 8),
    numero_unidad VARCHAR(50),
    folio VARCHAR(20) UNIQUE NOT NULL,
    
    -- Campos específicos de otras quejas
    detalles_otro TEXT,
    
    -- Campos de control
    estado_queja VARCHAR(20) DEFAULT 'Pendiente',
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT
);

-- ===========================================
-- TABLA DE RESOLUCIONES
-- ===========================================

CREATE TABLE IF NOT EXISTS resoluciones (
    id SERIAL PRIMARY KEY,
    folio_queja VARCHAR(20) NOT NULL,
    texto_resolucion TEXT NOT NULL,
    responsable VARCHAR(50) NOT NULL,
    procedencia VARCHAR(20) NOT NULL,
    fecha_resolucion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    estado_resolucion VARCHAR(20) DEFAULT 'Completada',
    ip_address INET,
    user_agent TEXT
);

-- ===========================================
-- TABLA DE AUDITORÍA
-- ===========================================

CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    table_name VARCHAR(50),
    record_id INTEGER,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================================
-- ÍNDICES PARA OPTIMIZACIÓN
-- ===========================================

-- Índices para quejas_retraso
CREATE INDEX IF NOT EXISTS idx_quejas_retraso_folio ON quejas_retraso(folio);
CREATE INDEX IF NOT EXISTS idx_quejas_retraso_estado ON quejas_retraso(estado_queja);
CREATE INDEX IF NOT EXISTS idx_quejas_retraso_fecha ON quejas_retraso(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_quejas_retraso_empleado ON quejas_retraso(numero_empleado);
CREATE INDEX IF NOT EXISTS idx_quejas_retraso_empresa ON quejas_retraso(empresa);

-- Índices para quejas_mal_trato
CREATE INDEX IF NOT EXISTS idx_quejas_mal_trato_folio ON quejas_mal_trato(folio);
CREATE INDEX IF NOT EXISTS idx_quejas_mal_trato_estado ON quejas_mal_trato(estado_queja);
CREATE INDEX IF NOT EXISTS idx_quejas_mal_trato_fecha ON quejas_mal_trato(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_quejas_mal_trato_empleado ON quejas_mal_trato(numero_empleado);
CREATE INDEX IF NOT EXISTS idx_quejas_mal_trato_empresa ON quejas_mal_trato(empresa);

-- Índices para quejas_inseguridad
CREATE INDEX IF NOT EXISTS idx_quejas_inseguridad_folio ON quejas_inseguridad(folio);
CREATE INDEX IF NOT EXISTS idx_quejas_inseguridad_estado ON quejas_inseguridad(estado_queja);
CREATE INDEX IF NOT EXISTS idx_quejas_inseguridad_fecha ON quejas_inseguridad(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_quejas_inseguridad_empleado ON quejas_inseguridad(numero_empleado);
CREATE INDEX IF NOT EXISTS idx_quejas_inseguridad_empresa ON quejas_inseguridad(empresa);

-- Índices para quejas_unidad_mal_estado
CREATE INDEX IF NOT EXISTS idx_quejas_unidad_mal_estado_folio ON quejas_unidad_mal_estado(folio);
CREATE INDEX IF NOT EXISTS idx_quejas_unidad_mal_estado_estado ON quejas_unidad_mal_estado(estado_queja);
CREATE INDEX IF NOT EXISTS idx_quejas_unidad_mal_estado_fecha ON quejas_unidad_mal_estado(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_quejas_unidad_mal_estado_empleado ON quejas_unidad_mal_estado(numero_empleado);
CREATE INDEX IF NOT EXISTS idx_quejas_unidad_mal_estado_empresa ON quejas_unidad_mal_estado(empresa);

-- Índices para quejas_otro
CREATE INDEX IF NOT EXISTS idx_quejas_otro_folio ON quejas_otro(folio);
CREATE INDEX IF NOT EXISTS idx_quejas_otro_estado ON quejas_otro(estado_queja);
CREATE INDEX IF NOT EXISTS idx_quejas_otro_fecha ON quejas_otro(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_quejas_otro_empleado ON quejas_otro(numero_empleado);
CREATE INDEX IF NOT EXISTS idx_quejas_otro_empresa ON quejas_otro(empresa);

-- Índices para resoluciones
CREATE INDEX IF NOT EXISTS idx_resoluciones_folio ON resoluciones(folio_queja);
CREATE INDEX IF NOT EXISTS idx_resoluciones_fecha ON resoluciones(fecha_resolucion);
CREATE INDEX IF NOT EXISTS idx_resoluciones_responsable ON resoluciones(responsable);

-- Índices para audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_name ON audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- ===========================================
-- TRIGGERS PARA AUDITORÍA
-- ===========================================

-- Función para actualizar timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers para actualizar updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_quejas_retraso_updated_at BEFORE UPDATE ON quejas_retraso FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_quejas_mal_trato_updated_at BEFORE UPDATE ON quejas_mal_trato FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_quejas_inseguridad_updated_at BEFORE UPDATE ON quejas_inseguridad FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_quejas_unidad_mal_estado_updated_at BEFORE UPDATE ON quejas_unidad_mal_estado FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_quejas_otro_updated_at BEFORE UPDATE ON quejas_otro FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- DATOS INICIALES
-- ===========================================

-- Insertar usuario administrador por defecto
-- NOTA: Cambiar la contraseña después de la instalación inicial
-- Contraseña por defecto: admin123
INSERT INTO users (username, password_hash, role) VALUES 
('admin', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin')
ON CONFLICT (username) DO NOTHING;

-- ===========================================
-- VISTAS ÚTILES
-- ===========================================

-- Vista para todas las quejas
CREATE OR REPLACE VIEW v_all_quejas AS
SELECT 
    id, numero_empleado, empresa, ruta, colonia, turno, tipo, 
    latitud, longitud, numero_unidad, folio, estado_queja, 
    fecha_creacion, fecha_actualizacion, ip_address, user_agent,
    'quejas_retraso' as tabla_origen
FROM quejas_retraso
UNION ALL
SELECT 
    id, numero_empleado, empresa, ruta, colonia, turno, tipo, 
    latitud, longitud, numero_unidad, folio, estado_queja, 
    fecha_creacion, fecha_actualizacion, ip_address, user_agent,
    'quejas_mal_trato' as tabla_origen
FROM quejas_mal_trato
UNION ALL
SELECT 
    id, numero_empleado, empresa, ruta, colonia, turno, tipo, 
    latitud, longitud, numero_unidad, folio, estado_queja, 
    fecha_creacion, fecha_actualizacion, ip_address, user_agent,
    'quejas_inseguridad' as tabla_origen
FROM quejas_inseguridad
UNION ALL
SELECT 
    id, numero_empleado, empresa, ruta, colonia, turno, tipo, 
    latitud, longitud, numero_unidad, folio, estado_queja, 
    fecha_creacion, fecha_actualizacion, ip_address, user_agent,
    'quejas_unidad_mal_estado' as tabla_origen
FROM quejas_unidad_mal_estado
UNION ALL
SELECT 
    id, numero_empleado, empresa, ruta, colonia, turno, tipo, 
    latitud, longitud, numero_unidad, folio, estado_queja, 
    fecha_creacion, fecha_actualizacion, ip_address, user_agent,
    'quejas_otro' as tabla_origen
FROM quejas_otro;

-- ===========================================
-- COMENTARIOS Y DOCUMENTACIÓN
-- ===========================================

COMMENT ON TABLE users IS 'Tabla de usuarios del sistema';
COMMENT ON TABLE refresh_tokens IS 'Tokens de refresh para JWT';
COMMENT ON TABLE quejas_retraso IS 'Quejas relacionadas con retrasos de transporte';
COMMENT ON TABLE quejas_mal_trato IS 'Quejas relacionadas con mal trato de conductores';
COMMENT ON TABLE quejas_inseguridad IS 'Quejas relacionadas con inseguridad en el transporte';
COMMENT ON TABLE quejas_unidad_mal_estado IS 'Quejas relacionadas con mal estado de unidades';
COMMENT ON TABLE quejas_otro IS 'Otras quejas no categorizadas';
COMMENT ON TABLE resoluciones IS 'Resoluciones de quejas por parte de administradores';
COMMENT ON TABLE audit_log IS 'Log de auditoría para todas las acciones del sistema';

-- ===========================================
-- FIN DEL ESQUEMA
-- ===========================================
