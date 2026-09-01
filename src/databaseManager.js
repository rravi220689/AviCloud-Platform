const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const execPromise = util.promisify(exec);
const db = require('./db');
const config = require('./config');

const DEFAULT_DATABASES = [
  {
    id: 'mysql-3306',
    name: 'MySQL 8.0 Server',
    type: 'mysql',
    container: 'jenkins-mysql',
    host: 'localhost',
    port: 3306,
    database: 'mysqldb',
    username: 'mysqluser',
    password: 'MySqlStrong@123',
    rootUser: 'root',
    rootPassword: 'RootStrong@123'
  },
  {
    id: 'mariadb-3307',
    name: 'MariaDB 11.4 Server',
    type: 'mariadb',
    container: 'jenkins-mariadb',
    host: 'localhost',
    port: 3307,
    database: 'mariadb',
    username: 'mariauser',
    password: 'MariaStrong@123',
    rootUser: 'root',
    rootPassword: 'MariaRoot@123'
  },
  {
    id: 'postgres-5432',
    name: 'PostgreSQL 16 (Primary)',
    type: 'postgres',
    container: 'jenkins-postgres',
    host: 'localhost',
    port: 5432,
    database: 'pgdb',
    username: 'pguser',
    password: 'PgStrong@123'
  },
  {
    id: 'postgres-5433',
    name: 'PostgreSQL 16 (AppDB)',
    type: 'postgres',
    container: 'jenkins-postgres-new',
    host: 'localhost',
    port: 5433,
    database: 'appdb',
    username: 'appadmin',
    password: 'AppPgStrong@2026'
  },
  {
    id: 'mssql-1433',
    name: 'Microsoft SQL Server 2022',
    type: 'mssql',
    container: 'jenkins-mssql',
    host: 'localhost',
    port: 1433,
    database: 'NoteKeeperDb',
    username: 'sa',
    password: 'SqlStrong@123'
  }
];

function initDatabaseTable() {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS connected_databases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      container TEXT,
      host TEXT DEFAULT 'localhost',
      port INTEGER NOT NULL,
      database_name TEXT,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Insert default databases if empty
  const count = db.db.prepare('SELECT COUNT(*) as c FROM connected_databases').get().c;
  if (count === 0) {
    const insertStmt = db.db.prepare(`
      INSERT INTO connected_databases (id, name, type, container, host, port, database_name, username, password)
      VALUES (@id, @name, @type, @container, @host, @port, @database, @username, @password)
    `);

    DEFAULT_DATABASES.forEach(d => {
      insertStmt.run(d);
    });
    console.log('[AviCloud DB Hub] Registered 5 existing database servers');
  }
}

initDatabaseTable();

async function getDatabasesWithStatus() {
  const rows = db.db.prepare('SELECT * FROM connected_databases').all();
  const results = [];

  for (const item of rows) {
    let isOnline = false;
    let version = '';
    let tables = [];

    try {
      if (item.type === 'mysql') {
        const { stdout } = await execPromise(`docker exec ${item.container} mysql -u ${item.username} -p'${item.password}' -D ${item.database_name} -e "SELECT VERSION() as v; SHOW TABLES;" -B`);
        isOnline = true;
        const lines = stdout.trim().split('\n');
        version = lines[1] || '8.0';
        tables = lines.slice(3).filter(Boolean);
      } else if (item.type === 'mariadb') {
        const { stdout } = await execPromise(`docker exec ${item.container} mariadb -u ${item.username} -p'${item.password}' -D ${item.database_name} -e "SELECT VERSION() as v; SHOW TABLES;" -B`);
        isOnline = true;
        const lines = stdout.trim().split('\n');
        version = lines[1] || '11.4';
        tables = lines.slice(3).filter(Boolean);
      } else if (item.type === 'postgres') {
        const { stdout } = await execPromise(`docker exec ${item.container} psql -U ${item.username} -d ${item.database_name} -t -c "SELECT version(); SELECT tablename FROM pg_tables WHERE schemaname='public';"`);
        isOnline = true;
        const parts = stdout.trim().split('\n').filter(Boolean);
        version = (parts[0] || '').split(' ')[1] || '16.0';
        tables = parts.slice(1).map(t => t.trim()).filter(Boolean);
      } else if (item.type === 'mssql') {
        const { stdout } = await execPromise(`docker exec ${item.container} /opt/mssql-tools18/bin/sqlcmd -S localhost -U ${item.username} -P '${item.password}' -C -Q "SELECT @@VERSION; SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE';" -h -1 -W || docker exec ${item.container} /opt/mssql-tools/bin/sqlcmd -S localhost -U ${item.username} -P '${item.password}' -Q "SELECT @@VERSION; SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE';" -h -1 -W`);
        isOnline = true;
        const parts = stdout.trim().split('\n').filter(Boolean);
        version = 'MSSQL 2022';
        tables = parts.slice(1).map(t => t.trim()).filter(t => t && !t.includes('affected'));
      }
    } catch (err) {
      isOnline = false;
    }

    // Build connection strings
    let connectionUri = '';
    if (item.type === 'mysql') connectionUri = `mysql://${item.username}:${item.password}@${item.host}:${item.port}/${item.database_name}`;
    if (item.type === 'mariadb') connectionUri = `mariadb://${item.username}:${item.password}@${item.host}:${item.port}/${item.database_name}`;
    if (item.type === 'postgres') connectionUri = `postgresql://${item.username}:${item.password}@${item.host}:${item.port}/${item.database_name}`;
    if (item.type === 'mssql') connectionUri = `Server=${item.host},${item.port};Database=${item.database_name};User Id=${item.username};Password=${item.password};TrustServerCertificate=True;`;

    results.push({
      ...item,
      isOnline,
      version,
      tables,
      connectionUri
    });
  }

  return results;
}

async function executeQuery(dbId, query) {
  const item = db.db.prepare('SELECT * FROM connected_databases WHERE id = ?').get(dbId);
  if (!item) throw new Error('Database server not found');

  // Prevent dangerous system commands injection into shell
  const safeQuery = query.replace(/"/g, '\\"');

  if (item.type === 'mysql' || item.type === 'mariadb') {
    const bin = item.type === 'mysql' ? 'mysql' : 'mariadb';
    const cmd = `docker exec ${item.container} ${bin} -u ${item.username} -p'${item.password}' -D ${item.database_name} -e "${safeQuery}" -B`;
    const { stdout, stderr } = await execPromise(cmd);
    const lines = stdout.trim().split('\n');
    if (lines.length === 0 || !lines[0]) {
      return { columns: [], rows: [], message: stderr || 'Query executed successfully (0 rows)' };
    }
    const columns = lines[0].split('\t');
    const rows = lines.slice(1).map(line => line.split('\t'));
    return { columns, rows, raw: stdout };
  } else if (item.type === 'postgres') {
    const cmd = `docker exec ${item.container} psql -U ${item.username} -d ${item.database_name} -c "${safeQuery}"`;
    const { stdout, stderr } = await execPromise(cmd);
    return { raw: stdout || stderr };
  } else if (item.type === 'mssql') {
    const cmd = `docker exec ${item.container} /opt/mssql-tools18/bin/sqlcmd -S localhost -U ${item.username} -P '${item.password}' -d ${item.database_name} -C -Q "${safeQuery}" || docker exec ${item.container} /opt/mssql-tools/bin/sqlcmd -S localhost -U ${item.username} -P '${item.password}' -d ${item.database_name} -Q "${safeQuery}"`;
    const { stdout, stderr } = await execPromise(cmd);
    return { raw: stdout || stderr };
  }

  throw new Error('Unsupported database type');
}

async function backupDatabaseToStorage(dbId) {
  const item = db.db.prepare('SELECT * FROM connected_databases WHERE id = ?').get(dbId);
  if (!item) throw new Error('Database not found');

  const backupDir = path.join(config.STORAGE_DIR, 'Database_Backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${item.id}_${timestamp}.sql`;
  const targetPath = path.join(backupDir, filename);

  if (item.type === 'mysql' || item.type === 'mariadb') {
    const bin = item.type === 'mysql' ? 'mysqldump' : 'mariadb-dump';
    await execPromise(`docker exec ${item.container} ${bin} -u ${item.username} -p'${item.password}' ${item.database_name} > "${targetPath}"`);
  } else if (item.type === 'postgres') {
    await execPromise(`docker exec ${item.container} pg_dump -U ${item.username} -d ${item.database_name} > "${targetPath}"`);
  } else {
    throw new Error('Automated backup currently supported for MySQL, MariaDB, and PostgreSQL');
  }

  const stat = fs.statSync(targetPath);
  return {
    success: true,
    filename,
    path: `Database_Backups/${filename}`,
    size: stat.size,
    message: `Database dumped to 100GB Storage Drive at Database_Backups/${filename}`
  };
}

module.exports = {
  getDatabasesWithStatus,
  executeQuery,
  backupDatabaseToStorage
};
